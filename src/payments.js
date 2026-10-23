// Collecting money from the customer.
//
// The e-Solutions gateway draws from Bhadhala's prepaid vendor wallet; it does
// not charge the customer. A separate payment provider must collect EcoCash,
// OneMoney and card payments and credit Bhadhala.
//
// Replace the "mock" branches with the chosen provider. Mobile money is usually
// asynchronous: the customer approves a prompt on their phone and the provider
// calls a webhook. Only vend AFTER payment is confirmed.
const cfg = require("./config");

async function collect(order) {
  if (cfg.paymentsMode === "mock") {
    return { status: "paid", providerRef: "MOCKPAY" + Date.now() };
  }
  throw new Error("No payment provider configured. Set PAYMENTS_MODE and implement collect() in src/payments.js");
}

// Called when a vend fails for good after the customer has paid.
async function refund(order) {
  if (cfg.paymentsMode === "mock") {
    return { status: "refunded", providerRef: "MOCKREF" + Date.now() };
  }
  // Until refunds are automated, the order stays "refund_due" for staff to action.
  return { status: "refund_due" };
}

module.exports = { collect, refund };
