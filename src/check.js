// Account check: vendor wallet balances and which billers respond.
// Run with:  npm run check
// Uses the settings in .env. Sends enquiries only; nothing is bought.
const cfg = require("./config");
const gw = require("./gateway");

const auth = "Basic " + Buffer.from(`${cfg.gateway.username}:${cfg.gateway.password}`).toString("base64");
const money = (cents) => (Number(cents) / 100).toFixed(2);

async function balance(currency) {
  // Spec 4.2.1: Vendor Balance Enquiry, processing code 300000.
  const msg = {
    mti: "0200",
    vendorReference: "BHBAL" + Date.now().toString(36).toUpperCase() + currency,
    processingCode: "300000",
    transmissionDate: gw.transmissionDate(),
    vendorNumber: cfg.gateway.vendorNumber,
    currencyCode: currency,
    apiVersion: cfg.gateway.apiVersion,
  };
  if (process.env.VENDOR_ACCOUNT) msg.accountNumber = process.env.VENDOR_ACCOUNT;
  try {
    const r = await gw.send(msg);
    if (r.responseCode === "00" && r.vendorBalance) {
      const [name, acc, cur, bal] = r.vendorBalance.split("|");
      return `${cur || currency} wallet: ${money(bal)}  (${name}, account ${acc})`;
    }
    return `${currency} wallet: not available. Code ${r.responseCode}: ${r.narrative || "no message"}`;
  } catch (e) {
    return `${currency} wallet: no reply (${e.message})`;
  }
}

async function products(merchant) {
  // Spec 4.2.3: GET /billpayments/products/merchant/<code>
  const url = `${cfg.gateway.baseUrl}/billpayments/products/merchant/${merchant}`;
  try {
    const res = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch { return `${merchant}: HTTP ${res.status}, unreadable reply`; }
    if (j.responseCode && j.responseCode !== "00") return `${merchant}: code ${j.responseCode}, ${j.narrative || ""}`;
    const list = (j.products || []).map((p) => `${p.productName} [${p.productShortName || p.productCode}]`).join(", ");
    return `${merchant}: ${j.narrative || "OK"}${list ? "  ->  " + list : ""}`;
  } catch (e) {
    return `${merchant}: no reply (${e.message})`;
  }
}

(async () => {
  if (cfg.gatewayMode !== "live") {
    console.log("GATEWAY_MODE is not 'live' in .env, so this would only check the simulator. Set it to live first.");
    return;
  }
  console.log(`\nBhadala account check for vendor ${cfg.gateway.vendorNumber}\n`);
  console.log("WALLET BALANCES");
  for (const c of ["USD", "ZWG"]) console.log("  " + (await balance(c)));
  console.log("\nBILLERS (product lists)");
  for (const m of ["ECONET", "NETONE", "TELECEL", cfg.merchants.Water.merchantName]) console.log("  " + (await products(m)));
  console.log("\nNote: a biller can be listed here but still not be enabled for your vendor number. Only a test purchase proves that.\n");
})();
