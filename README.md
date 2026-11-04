# Bhadala

Airtime (Econet, NetOne, Telecel) and City of Harare prepaid water tokens, sold through the e-Solutions Bill Payments Gateway API v2.3.

## Run it

You need Node.js 20 or newer.

```
npm install
cp .env.example .env
npm start
```

Open http://localhost:3000. It starts in **test mode**: the gateway and payments are simulated, so nothing real is bought or charged.

### Test triggers (test mode only)

| Try this | What happens |
|---|---|
| Meter `00000000000` | "Invalid meter number" (code 14) |
| Amount `5.55` | Gateway error (05); customer is refunded |
| Amount `7.77` | "Still in progress" (09); confirmed on the next resend |
| Amount `6.66` | Network timeout; confirmed on the next resend |

In test mode, resends wait 3 minutes as the spec requires. To see them faster, set `FIRST_RESEND_MS=5000` and `RESEND_EVERY_MS=5000` in `.env`.

## Testing against the e-Solutions test gateway

In `.env`, set `GATEWAY_MODE=live` (the test URL is already filled in), plus your test `GATEWAY_USERNAME`, `GATEWAY_PASSWORD` and `VENDOR_NUMBER`. Keep `PAYMENTS_MODE=mock` so no customer is charged. Then buy small amounts on the site and check each one against the gateway's records.

## How a purchase works

1. **Water only:** the customer taps *Check meter*. The server sends a Customer Information request (310000) in "Estimated Cost" mode and shows the account name, debt deducted, other charges and estimated kL.
2. The customer pays (EcoCash, OneMoney or card).
3. Only after payment is confirmed, the server sends the purchase (U50000) from the vendor wallet.
4. Response `00` = done, show the receipt and token(s). Any code other than `00` or `09` = failed, refund the customer.
5. Response `09`, or no reply at all, means the outcome is **unknown**. The server sends a Resend (MTI 0201) after 180 s, then every 180 s, until it gets a final answer. It never refunds before then, because a token may already have been issued (spec section 4.2.2).

Pricing, commission and the water service fee live in `src/pricing.js`.

**Water (City of Harare) fees, USD:** the customer pays a service fee of 1.00 per started 100.00 of token value, capped at 10.00. e-Solutions charges Bhadala 0.5% of the token value (min 0.50, max 5.00). Example: a 1,000.00 token → customer fee 10.00, e-Solutions charge 5.00, Bhadala keeps 5.00.

## Before going live

- [x] **Test gateway endpoint:** `https://test.esolutions.co.zw/billpayments/vend` (already in `.env.example`).
- [ ] **Live gateway URL.** Still "TBA". Swap `GATEWAY_BASE_URL` when issued.
- [ ] **Authentication.** The spec says username and password. The code sends them as HTTP Basic auth; confirm that's the method.
- [ ] **Credentials.** Set `GATEWAY_USERNAME`, `GATEWAY_PASSWORD`, `VENDOR_NUMBER` in `.env` on the server only. Never in the web page, never in chat or email.
- [x] **Water merchant name:** `COH` / `COH_PREPAID` (City of Harare, spec section 5.11).
- [ ] **Customer payments.** The gateway spends from the vendor wallet; it does not charge customers. Choose a payment provider for EcoCash, OneMoney and cards and implement `collect()` and `refund()` in `src/payments.js`. Mobile money is asynchronous, so this will need a webhook.
- [ ] **Vendor wallet float.** Response `51` means the wallet is empty. Keep it topped up, and consider adding a low-balance alert (balance enquiry, processing code 300000).
- [ ] **SMS.** Send tokens to the customer by SMS, in the order given (some purchases return several tokens).
- [ ] **Database.** Orders are saved to `data/orders.json`. Fine for a pilot; move to a real database before real volume.
- [ ] **Hosting.** Run behind HTTPS. Set `GATEWAY_MODE=live` and `PAYMENTS_MODE` to your provider.
- [ ] **ZWG water fee.** The service fee is USD only for now.

## Files

- `public/index.html`: the storefront. It talks to the server when served by it, and falls back to a demo when opened on its own.
- `src/server.js`: web server, validation, API routes.
- `src/gateway.js`: builds and sends gateway messages.
- `src/mockGateway.js`: the test-mode simulator.
- `src/orders.js`: order lifecycle and the resend loop.
- `src/payments.js`: customer payments (to be implemented).
- `src/pricing.js`: commissions and fees.
