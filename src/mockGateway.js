// Simulates the gateway using the sample messages in API spec v2.3,
// so Bhadala can be built and tested before live access.
//
// Test triggers:
//   meter 00000000000         -> 14 Invalid meter number
//   amount 7.77               -> 09 in progress, success on the next resend
//   amount 6.66               -> communication timeout, success on resend
//   amount 5.55               -> 05 General error
const seen = new Map(); // vendorReference -> final response

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const token20 = () => Array.from({ length: 5 }, () => String(Math.floor(1000 + Math.random() * 9000))).join("-");

function reply(req, extra) {
  return {
    mti: req.mti === "0201" ? "0211" : "0210",
    vendorReference: req.vendorReference,
    processingCode: req.processingCode,
    transactionAmount: req.transactionAmount,
    transmissionDate: req.transmissionDate,
    vendorNumber: req.vendorNumber,
    transactionReference: "ESO" + Date.now(),
    merchantName: req.merchantName,
    productName: req.productName,
    utilityAccount: req.utilityAccount,
    currencyCode: req.currencyCode,
    apiVersion: "02",
    ...extra,
  };
}

function success(req) {
  if (req.merchantName === "COH" || req.merchantName === "HARARE") {
    const amt = (req.transactionAmount / 100).toFixed(2);
    const kl = (req.transactionAmount / 100 / 2.5).toFixed(2);
    return reply(req, {
      responseCode: "00",
      narrative: "Transaction Successfully Processed",
      token: token20(),
      arrears: "0.00",
      fixedCharges: "0.00",
      miscellaneousData: kl,
      receiptNumber: String(Date.now()).padEnd(16, "0").slice(0, 16),
      customerData: `${amt}|${kl}|${amt}|1.0000|15.00|0.00`,
      settlementCurrencyCode: req.currencyCode,
    });
  }
  return reply(req, { responseCode: "00", narrative: "Transaction Successful", requiresVoucher: false });
}

async function handle(req) {
  await delay(400);
  const amount = (req.transactionAmount || 0) / 100;

  // Customer information (310000)
  if (req.processingCode === "310000") {
    if (/^0+$/.test(req.utilityAccount)) return reply(req, { responseCode: "14", narrative: "Invalid meter number" });
    const base = { responseCode: "00", narrative: "Transaction Successfully Processed", customerData: "T MOYO" };
    if (!req.transactionAmount) return reply(req, { ...base, arrears: "0.00" });
    return reply(req, { ...base, arrears: "0.00", fixedCharges: "0.00", miscellaneousData: (amount / 2.5).toFixed(2) });
  }

  // Resend: report what happened to the original
  if (req.mti === "0201") {
    const final = seen.get(req.originalReference) || success({ ...req, mti: "0200", vendorReference: req.originalReference });
    seen.set(req.originalReference, final);
    return { ...final, mti: "0211", vendorReference: req.vendorReference, narrative: "Original transaction completed successfully" };
  }

  // Purchase (U50000)
  if (/^0+$/.test(req.utilityAccount || "")) return reply(req, { responseCode: "14", narrative: "Invalid meter number" });
  if (amount === 5.55) return reply(req, { responseCode: "05", narrative: "General error: Merchant system unavailable" });
  if (amount === 7.77) {
    seen.set(req.vendorReference, success(req)); // completes later
    return reply(req, { responseCode: "09", narrative: "Transaction still in progress" });
  }
  if (amount === 6.66) {
    seen.set(req.vendorReference, success(req));
    const { GatewayTimeout } = require("./gateway"); // lazy to avoid a circular import
    throw new GatewayTimeout("Simulated network timeout");
  }
  const res = success(req);
  seen.set(req.vendorReference, res);
  return res;
}

module.exports = { handle };
