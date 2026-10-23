// All settings come from environment variables (see .env.example).
// Never put real credentials in this file or in the web page.
require("dotenv").config();

const env = (k, d) => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);

module.exports = {
  port: Number(env("PORT", 3000)),

  // "mock" uses the built-in simulator. "live" calls the real gateway.
  gatewayMode: env("GATEWAY_MODE", "mock"),
  gateway: {
    // Test gateway: https://test.esolutions.co.zw ; live URL still to be issued.
    baseUrl: env("GATEWAY_BASE_URL", ""),
    // Transaction endpoint confirmed: /billpayments/vend
    txnPath: env("GATEWAY_TXN_PATH", "/billpayments/vend"),
    username: env("GATEWAY_USERNAME", ""),
    password: env("GATEWAY_PASSWORD", ""),
    vendorNumber: env("VENDOR_NUMBER", "VE00000000000"),
    terminalId: env("TERMINAL_ID", "BHADHALA01"),
    apiVersion: "02",
  },

  // Spec section 4.2.2: 60s call timeout, first resend after 180s, then every 180s.
  timeouts: {
    callMs: Number(env("CALL_TIMEOUT_MS", 60000)),
    firstResendMs: Number(env("FIRST_RESEND_MS", 180000)),
    resendEveryMs: Number(env("RESEND_EVERY_MS", 180000)),
  },

  // Merchant and product names. Section 5.11 uses COH/COH_PREPAID;
  // Table 6.1 lists HARARE/HARARE. Override here if e-Solutions says otherwise.
  merchants: {
    Econet:  { merchantName: "ECONET",  productName: "ECONET_AIRTIME" },
    NetOne:  { merchantName: "NETONE",  productName: "NETONE_AIRTIME", serviceId: "CS" },
    Telecel: { merchantName: "TELECEL", productName: "TELECEL_AIRTIME" },
    Water:   { merchantName: env("COH_MERCHANT", "COH"), productName: env("COH_PRODUCT", "COH_PREPAID") },
  },

  // "mock" auto-approves. Replace with a real collector (see src/payments.js).
  paymentsMode: env("PAYMENTS_MODE", "mock"),
};
