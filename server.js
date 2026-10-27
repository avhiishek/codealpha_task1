const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;
const db = new sqlite3.Database(path.join(__dirname, "store.db"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-local-demo-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));
app.use(express.static(path.join(__dirname, "public")));

const run = (sql, params = []) => new Promise((resolve, reject) =>
  db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
const all = (sql, params = []) => new Promise((resolve, reject) =>
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
const get = (sql, params = []) => new Promise((resolve, reject) =>
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));

async function init() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL, password TEXT NOT NULL)`);
  await run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    description TEXT NOT NULL, price REAL NOT NULL, image TEXT NOT NULL)`);
  await run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    items TEXT NOT NULL, total REAL NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  const count = await get("SELECT COUNT(*) AS n FROM products");
  if (!count.n) {
    const products = [
      ["Wireless Headphones","Comfortable headphones for music and calls.",1499,"https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80"],
      ["Smart Watch","Everyday watch with a clean, modern design.",2199,"https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80"],
      ["Travel Backpack","A practical backpack for college and short trips.",999,"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=800&q=80"],
      ["Desk Lamp","Minimal desk lamp for your study space.",699,"https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=800&q=80"],
      ["Running Shoes","Lightweight shoes for daily walks and runs.",1799,"https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80"],
      ["Coffee Mug","A simple ceramic mug for your desk.",299,"https://images.unsplash.com/photo-1514228742587-6b1558f&fit=crop&w=800&q=80"]
    ];
    for (const item of products) await run(
      "INSERT INTO products (name,description,price,image) VALUES (?,?,?,?)", item);
  }
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please log in first." });
  next();
}

app.get("/api/me", (req, res) => res.json({ user: req.session.user || null }));
app.get("/api/products", async (req, res) => {
  try { res.json(await all("SELECT * FROM products ORDER BY id")); }
  catch { res.status(500).json({ error: "Could not load products." }); }
});
app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await get("SELECT * FROM products WHERE id = ?", [req.params.id]);
    if (!product) return res.status(404).json({ error: "Product not found." });
    res.json(product);
  } catch { res.status(500).json({ error: "Could not load product." }); }
});
app.post("/api/register", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!name || !email.includes("@") || password.length < 6)
    return res.status(400).json({ error: "Enter a name, valid email and password with at least 6 characters." });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await run("INSERT INTO users (name,email,password) VALUES (?,?,?)", [name,email,hash]);
    req.session.user = { id: result.lastID, name, email };
    res.json({ user: req.session.user });
  } catch (err) {
    res.status(err.code === "SQLITE_CONSTRAINT" ? 409 : 500)
      .json({ error: err.code === "SQLITE_CONSTRAINT" ? "This email is already registered." : "Could not create account." });
  }
});
app.post("/api/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  try {
    const user = await get("SELECT * FROM users WHERE email = ?", [email]);
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: "Email or password is incorrect." });
    req.session.user = { id: user.id, name: user.name, email: user.email };
    res.json({ user: req.session.user });
  } catch { res.status(500).json({ error: "Could not log in." }); }
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.post("/api/orders", requireLogin, async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "Your cart is empty." });
  try {
    const productIds = [...new Set(items.map(x => Number(x.id)).filter(Number.isInteger))];
    const products = await all(`SELECT id,name,price FROM products WHERE id IN (${productIds.map(()=>"?").join(",") || "NULL"})`, productIds);
    const map = new Map(products.map(x => [x.id, x]));
    const orderItems = [];
    let total = 0;
    for (const item of items) {
      const product = map.get(Number(item.id));
      const quantity = Math.min(20, Math.max(1, parseInt(item.quantity, 10) || 1));
      if (!product) return res.status(400).json({ error: "A product in your cart is no longer available." });
      total += product.price * quantity;
      orderItems.push({ id: product.id, name: product.name, price: product.price, quantity });
    }
    const result = await run("INSERT INTO orders (user_id,items,total) VALUES (?,?,?)",
      [req.session.user.id, JSON.stringify(orderItems), total]);
    res.json({ orderId: result.lastID, total });
  } catch { res.status(500).json({ error: "Could not place order." }); }
});
app.get("/api/orders", requireLogin, async (req, res) => {
  try {
    res.json(await all("SELECT id,items,total,created_at FROM orders WHERE user_id = ? ORDER BY id DESC", [req.session.user.id]));
  } catch { res.status(500).json({ error: "Could not load orders." }); }
});

init().then(() => app.listen(PORT, () => console.log(`E-commerce store running at http://localhost:${PORT}`)))
  .catch(err => { console.error(err); process.exit(1); });
