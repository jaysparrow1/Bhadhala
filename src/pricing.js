// Commercial terms (Appendix 1) plus Bhadala's own water service fee.
// Amounts here are in major units (dollars), not cents.

const COMMISSION = {
  Econet:  { USD: 0.05,  ZWG: 0.035 },
  NetOne:  { USD: 0.055, ZWG: 0.055 },
  Telecel: { USD: 0.055, ZWG: 0.055 },
  Water:   { USD: 0,     ZWG: 0 },
};

// City of Harare: 0.5% charged to the vendor, min 0.50, max 5.00 (USD).
// ZWG caps are not stated in Appendix 1, so 0.5% is applied uncapped.
function gatewayCharge(product, currency, amount) {
  if (product !== "Water") return 0;
  const fee = amount * 0.005;
  return currency === "USD" ? Math.min(5, Math.max(0.5, fee)) : fee;
}

// Bhadala water service fee charged to the customer (USD only for now):
// 1.00 per started 100.00 of token value, capped at 10.00.
// e-Solutions' own charge to Bhadala is capped at 5.00, so the top tier keeps 5.00.
function serviceFee(product, currency, amount) {
  if (product !== "Water" || currency !== "USD" || amount <= 0) return 0;
  return Math.min(10, Math.ceil(amount / 100));
}

const LIMITS = {
  airtime: { USD: [1, 500],   ZWG: [1, 5000] },
  water:   { USD: [5, 1000],  ZWG: [100, 25000] },
};

const round2 = (n) => Math.round(n * 100) / 100;

function quote(product, currency, amount) {
  const commission = amount * COMMISSION[product][currency];
  const charge = gatewayCharge(product, currency, amount);
  const fee = serviceFee(product, currency, amount);
  return {
    amount: round2(amount),
    serviceFee: round2(fee),
    customerPays: round2(amount + fee),
    vendorCommission: round2(commission),
    gatewayCharge: round2(charge),
    vendorEarns: round2(commission - charge + fee),
  };
}

module.exports = { quote, LIMITS, COMMISSION };
