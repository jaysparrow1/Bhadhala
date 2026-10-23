// Client for the e-Solutions Bill Payments Gateway API v2.3.
const crypto = require("crypto");
const cfg = require("./config");
const mock = require("./mockGateway");

const pad = (n) => String(n).padStart(2, "0");

// Format MMDDYYHHmmss (spec 4.2, Transmission Date)
function transmissionDate(d = new Date()) {
  return pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getFullYear() % 100) +
         pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

// Alphanumeric and unique per vendor; duplicates are rejected (code 94).
function newVendorReference() {
  return "BH" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString("hex").toUpperCase();
}

const cents = (amount) => Math.round(amount * 100);

// Converts a local number (0771234567) to the gateway format (263771234567).
function toMsisdn(local) {
  return "263" + local.replace(/^0/, "");
}

function baseMessage(processingCode) {
  return {
    mti: "0200",
    vendorReference: newVendorReference(),
    processingCode,
    transmissionDate: transmissionDate(),
    vendorNumber: cfg.gateway.vendorNumber,
    apiVersion: cfg.gateway.apiVersion,
  };
}

class GatewayTimeout extends Error {}

// Logs each gateway exchange to the terminal. The password is never printed.
function log(label, obj) {
  console.log(`[${new Date().toLocaleTimeString()}] ${label}`, JSON.stringify(obj));
}

async function send(message) {
  if (cfg.gatewayMode !== "live") return mock.handle(message);
  log("-> gateway", message);
  try {
    const res = await sendLive(message);
    log("<- gateway", res);
    return res;
  } catch (err) {
    log("!! gateway problem", { error: err.message, cause: err.cause && (err.cause.code || err.cause.message) });
    throw err;
  }
}

async function sendLive(message) {

  if (!cfg.gateway.baseUrl) throw new Error("GATEWAY_BASE_URL is not set");
  const auth = Buffer.from(`${cfg.gateway.username}:${cfg.gateway.password}`).toString("base64");
  try {
    const res = await fetch(cfg.gateway.baseUrl + cfg.gateway.txnPath, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(cfg.timeouts.callMs),
    });
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { throw new GatewayTimeout(`Unreadable gateway reply (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  } catch (err) {
    // Any communication failure means the outcome is unknown, so treat it like a timeout.
    if (err instanceof GatewayTimeout) throw err;
    const e = new GatewayTimeout(err.message);
    e.cause = err.cause;
    throw e;
  }
}

// ---- Message builders ----

function airtimeMessage({ network, phone, amount, currency }) {
  const m = cfg.merchants[network];
  const msisdn = toMsisdn(phone);
  const msg = {
    ...baseMessage("U50000"),
    transactionAmount: cents(amount),
    sourceMobile: msisdn,
    targetMobile: msisdn,
    utilityAccount: msisdn, // spec: same value as targetMobile
    merchantName: m.merchantName,
    productName: m.productName,
    terminalID: cfg.gateway.terminalId,
    currencyCode: currency,
  };
  if (m.serviceId) msg.serviceId = m.serviceId;
  return msg;
}

function waterLookupMessage({ meter, amount, currency }) {
  const m = cfg.merchants.Water;
  const msg = {
    ...baseMessage("310000"),
    merchantName: m.merchantName,
    productName: m.productName,
    utilityAccount: meter,
    currencyCode: currency,
  };
  // Including an amount switches COH to "Estimated Cost" mode.
  if (amount) msg.transactionAmount = cents(amount);
  return msg;
}

function waterPurchaseMessage({ meter, amount, currency, phone }) {
  const m = cfg.merchants.Water;
  return {
    ...baseMessage("U50000"),
    transactionAmount: cents(amount),
    terminalID: cfg.gateway.terminalId,
    merchantName: m.merchantName,
    productName: m.productName,
    utilityAccount: meter,
    sourceMobile: phone ? toMsisdn(phone) : undefined,
    currencyCode: currency,
  };
}

// Resend / lookup (spec 4.2.2): same request, MTI 0201, new vendorReference,
// originalReference = the original vendorReference.
function resendMessage(original) {
  return {
    ...original,
    mti: "0201",
    vendorReference: newVendorReference(),
    originalReference: original.vendorReference,
    transmissionDate: transmissionDate(),
  };
}

// ---- Response helpers ----

// 00 = success, 09 = still in progress, anything else = failed.
function outcome(res) {
  if (!res) return "unknown";
  if (res.responseCode === "00") return "success";
  if (res.responseCode === "09") return "pending";
  return "failed";
}

// Token field: records separated by '#', sub-fields by '|'. Customers load tokens in order.
function parseTokens(tokenField) {
  if (!tokenField) return [];
  return String(tokenField).split("#").map((r) => r.split("|")[0].trim()).filter(Boolean);
}

// COH purchase customerData: rechargeAmount|rechargeVolume|receiveAmount|exchangeRate|vatRate|vatAmount
function parseCohCustomerData(s) {
  const [rechargeAmount, rechargeVolume, receiveAmount, exchangeRate, vatRate, vatAmount] = String(s || "").split("|");
  return { rechargeAmount, rechargeVolume, receiveAmount, exchangeRate, vatRate, vatAmount };
}

module.exports = {
  send, GatewayTimeout, outcome, parseTokens, parseCohCustomerData,
  airtimeMessage, waterLookupMessage, waterPurchaseMessage, resendMessage,
  transmissionDate, toMsisdn,
};
