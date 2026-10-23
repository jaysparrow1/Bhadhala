// Minimal order store in a JSON file. Fine for a pilot; move to a real
// database (e.g. PostgreSQL) before handling serious volume.
const fs = require("fs");
const path = require("path");

const FILE = process.env.ORDERS_FILE || path.join(__dirname, "..", "data", "orders.json");
let orders = {};

try { orders = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { orders = {}; }

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
  fs.renameSync(tmp, FILE);
}

const get = (id) => orders[id];
const all = () => Object.values(orders);

function put(order) {
  order.updatedAt = new Date().toISOString();
  orders[order.id] = order;
  save();
  return order;
}

module.exports = { get, put, all };
