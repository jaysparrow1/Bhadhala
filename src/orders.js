// Order lifecycle: created -> paid -> vending -> success | pending | failed
// A failed vend after payment moves to refunded or refund_due.
const crypto = require("crypto");
const cfg = require("./config");
const gw = require("./gateway");
const store = require("./store");
const payments = require("./payments");
const { quote } = require("./pricing");

const timers = new Map();

// Problems on Bhadala's side (empty wallet, login) are not the customer's business.
// Show a neutral message and raise an alert for the owner instead.
const INTERNAL_CODES = {
  "16": "Vendor wallet has insufficient funds",
  "51": "Vendor wallet has insufficient funds",
  "63": "Gateway login failed (check username/password)",
  "80": "Currency not set up for this vendor",
};

function customerMessage(res) {
  const code = res.responseCode;
  if (INTERNAL_CODES[code]) {
    console.log(`!!! ALERT [${new Date().toLocaleString()}] ${INTERNAL_CODES[code]}. Code ${code}, currency ${res.currencyCode}, ref ${res.transactionReference || "-"}`);
    return "This service is briefly unavailable. Please try again later.";
  }
  if (code === "14") return "That meter number was not accepted. Check it and try again.";
  return res.narrative || "";
}

function publicView(o) {
  return {
    id: o.id, status: o.status, product: o.product, network: o.network,
    phone: o.phone, meter: o.meter, currency: o.currency, quote: o.quote,
    message: o.message, receipt: o.receipt, createdAt: o.createdAt, updatedAt: o.updatedAt,
  };
}

function buildReceipt(order, res) {
  const r = { reference: res.transactionReference, gatewayRef: res.vendorReference };
  if (order.product === "Water") {
    const d = gw.parseCohCustomerData(res.customerData);
    r.tokens = gw.parseTokens(res.token);
    r.volumeKl = d.rechargeVolume || res.miscellaneousData;
    r.receiptNumber = res.receiptNumber;     // COH 16-char ID; keep for reconciliation
    r.arrears = res.arrears;
    r.fixedCharges = res.fixedCharges;
    r.vat = d.vatAmount;
  }
  return r;
}

async function settle(order, res) {
  const result = gw.outcome(res);
  order.lastResponse = res;
  order.gatewayNarrative = res.narrative || "";
  order.message = customerMessage(res);

  if (result === "success") {
    order.status = "success";
    order.receipt = buildReceipt(order, res);
  } else if (result === "pending") {
    order.status = "pending";
    scheduleResend(order, cfg.timeouts.resendEveryMs);
  } else {
    order.status = "failed";
    order.failCode = res.responseCode;
    const refund = await payments.refund(order);
    order.status = refund.status; // refunded | refund_due
  }
  store.put(order);
}

// Spec 4.2.2: never treat a timeout as a failure. Resend until a final answer.
function scheduleResend(order, waitMs) {
  clearTimeout(timers.get(order.id));
  order.nextResendAt = new Date(Date.now() + waitMs).toISOString();
  store.put(order);
  timers.set(order.id, setTimeout(() => resend(order.id), waitMs));
}

async function resend(id) {
  const order = store.get(id);
  if (!order || order.status !== "pending") return;
  order.resends = (order.resends || 0) + 1;
  const msg = gw.resendMessage(order.request);
  try {
    const res = await gw.send(msg);
    await settle(order, res);
  } catch (err) {
    order.message = "Still confirming with the network.";
    scheduleResend(order, cfg.timeouts.resendEveryMs);
  }
}

async function create(input) {
  const product = input.product === "water" ? "Water" : input.network;
  const order = {
    id: crypto.randomUUID(),
    product, network: input.network || null,
    phone: input.phone, meter: input.meter || null,
    currency: input.currency,
    quote: quote(product, input.currency, input.amount),
    status: "created", createdAt: new Date().toISOString(),
  };
  store.put(order);

  // 1. Take the customer's money first.
  const pay = await payments.collect(order);
  if (pay.status !== "paid") {
    order.status = "payment_failed";
    order.message = "Payment was not completed.";
    return publicView(store.put(order));
  }
  order.payment = pay;
  order.status = "vending";

  // 2. Vend from the vendor wallet.
  const args = { phone: input.phone, amount: input.amount, currency: input.currency };
  order.request = product === "Water"
    ? gw.waterPurchaseMessage({ ...args, meter: input.meter })
    : gw.airtimeMessage({ ...args, network: input.network });
  store.put(order);

  try {
    const res = await gw.send(order.request);
    await settle(order, res);
  } catch (err) {
    // Outcome unknown: hold the money, look it up later.
    order.status = "pending";
    order.message = "Waiting for the network to confirm.";
    scheduleResend(order, cfg.timeouts.firstResendMs);
  }
  return publicView(order);
}

// Pick up unfinished orders after a restart.
function resumePending() {
  for (const o of store.all()) {
    if ((o.status === "pending" || o.status === "vending") && !o.request) {
      o.status = "refund_due"; // paid but never sent to the gateway
      o.message = "Purchase was not sent. Refund due.";
      store.put(o);
    } else if (o.status === "pending" || o.status === "vending") {
      o.status = "pending";
      const wait = Math.max(1000, new Date(o.nextResendAt || 0) - Date.now());
      scheduleResend(o, wait);
    }
  }
}

module.exports = { create, publicView, resumePending };
