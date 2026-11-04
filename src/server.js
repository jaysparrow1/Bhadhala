const path = require("path");
const express = require("express");
const cfg = require("./config");
const gw = require("./gateway");
const orders = require("./orders");
const store = require("./store");
const { quote, LIMITS } = require("./pricing");

const app = express();
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const NETWORK_PREFIX = { Econet: ["077", "078", "079"], NetOne: ["071", "072"], Telecel: ["073"] };

function normPhone(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (d.startsWith("263")) d = "0" + d.slice(3);
  if (d.length === 9 && d[0] === "7") d = "0" + d;
  return d;
}
const networkOf = (p) => Object.keys(NETWORK_PREFIX).find((n) => NETWORK_PREFIX[n].some((x) => p.startsWith(x)));

function validate(body) {
  const product = body.product === "water" ? "water" : "airtime";
  const currency = body.currency;
  const amount = Number(body.amount);
  if (!["USD", "ZWG"].includes(currency)) return { error: "Choose USD or ZWG." };
  if (!Number.isFinite(amount)) return { error: "Enter an amount." };
  const [lo, hi] = LIMITS[product][currency];
  if (amount < lo || amount > hi) return { error: `Amount must be between ${lo} and ${hi} ${currency}.` };
  if (Math.round(amount * 100) !== amount * 100) return { error: "Use at most two decimal places." };

  const phone = normPhone(body.phone);
  const net = networkOf(phone);
  if (phone.length !== 10 || !net) return { error: "Use a Zimbabwe mobile number starting 071, 072, 073, 077, 078 or 079." };

  if (product === "airtime") {
    if (!NETWORK_PREFIX[body.network]) return { error: "Choose a network." };
    if (net !== body.network) return { error: `That number is on ${net}, not ${body.network}.` };
    return { ok: { product, network: body.network, phone, amount, currency } };
  }
  const meter = String(body.meter || "").replace(/\D/g, "");
  if (meter.length < 8 || meter.length > 13) return { error: "Check the meter number. It is usually 11 digits." };
  return { ok: { product, phone, meter, amount, currency } };
}

app.get("/api/health", (req, res) => res.json({ ok: true, gatewayMode: cfg.gatewayMode, paymentsMode: cfg.paymentsMode }));

app.post("/api/quote", (req, res) => {
  const { product, network, currency, amount } = req.body;
  const p = product === "water" ? "Water" : network;
  if (!["Econet", "NetOne", "Telecel", "Water"].includes(p) || !["USD", "ZWG"].includes(currency)) return res.status(400).json({ error: "Bad request" });
  res.json(quote(p, currency, Number(amount) || 0));
});

// Meter check before payment (COH "Estimated Cost" mode when an amount is sent).
app.post("/api/water/lookup", async (req, res) => {
  const meter = String(req.body.meter || "").replace(/\D/g, "");
  const currency = req.body.currency;
  const amount = Number(req.body.amount) || 0;
  if (meter.length < 8 || meter.length > 13) return res.status(400).json({ error: "Check the meter number. It is usually 11 digits." });
  if (!["USD", "ZWG"].includes(currency)) return res.status(400).json({ error: "Choose USD or ZWG." });
  try {
    // Try "Estimated Cost" mode first (with amount). If COH rejects it, fall back to
    // "Basic Lookup" (meter only), which returns the name and total outstanding debt.
    let r = await gw.send(gw.waterLookupMessage({ meter, amount, currency }));
    let mode = amount ? "estimate" : "basic";
    if (r.responseCode !== "00" && amount) {
      r = await gw.send(gw.waterLookupMessage({ meter, currency }));
      mode = "basic";
    }
    if (r.responseCode !== "00") return res.status(422).json({ error: r.narrative || "Meter could not be verified.", code: r.responseCode });
    res.json(mode === "estimate"
      ? { meter, mode, name: r.customerData, arrears: r.arrears, fixedCharges: r.fixedCharges, estimatedKl: r.miscellaneousData, currency }
      : { meter, mode, name: r.customerData, outstandingDebt: r.arrears, currency });
  } catch (err) {
    res.status(504).json({ error: "City of Harare did not respond. Try again in a minute." });
  }
});

app.post("/api/orders", async (req, res) => {
  const v = validate(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    res.status(201).json(await orders.create(v.ok));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. You have not been charged twice; contact support with the time of purchase." });
  }
});

app.get("/api/orders/:id", (req, res) => {
  const o = store.get(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found." });
  res.json(orders.publicView(o));
});

orders.resumePending();
app.listen(cfg.port, () => console.log(`Bhadala on http://localhost:${cfg.port} (gateway: ${cfg.gatewayMode}, payments: ${cfg.paymentsMode})`));
