const grid = document.querySelector("#productGrid");
const productDialog = document.querySelector("#productDialog");
const authDialog = document.querySelector("#authDialog");
let currentUser = null;
let authMode = "login";
let products = [];
let toastTimer;

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function money(value) { return new Intl.NumberFormat("en-IN", { style:"currency", currency:"INR", maximumFractionDigits:0 }).format(value); }
function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
async function loadProducts() {
  try {
    products = await api("/api/products");
    document.querySelector("#productCount").textContent = `${products.length} products`;
    grid.innerHTML = products.map(p => `
      <article class="product-card">
        <div class="product-image" data-product="${p.id}"><img src="${p.image}" alt="${p.name}" loading="lazy"></div>
        <div class="product-info"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description)}</p>
          <div class="product-bottom"><span class="price">${money(p.price)}</span><button class="text-button" data-product="${p.id}">View details ↗</button></div>
        </div>
      </article>`).join("");
  } catch { grid.innerHTML = "<p>Products could not be loaded. Restart the server and refresh.</p>"; }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch]));
}
grid.addEventListener("click", event => {
  const button = event.target.closest("[data-product]");
  if (button) showProduct(Number(button.dataset.product));
});
function showProduct(id) {
  const p = products.find(item => item.id === id);
  if (!p) return;
  document.querySelector("#productDetail").innerHTML = `
    <img src="${p.image}" alt="${escapeHtml(p.name)}">
    <p class="eyebrow">PRODUCT DETAILS</p><h2>${escapeHtml(p.name)}</h2>
    <p>${escapeHtml(p.description)}</p><div class="detail-actions"><strong>${money(p.price)}</strong>
    <button class="button" id="addToCart">Add to cart</button></div>
    <div id="cartArea"></div>`;
  document.querySelector("#addToCart").onclick = () => addToCart(p.id);
  productDialog.showModal();
}
function readCart() {
  try { return JSON.parse(sessionStorage.getItem("northstar-cart") || "[]"); } catch { return []; }
}
function saveCart(cart) { sessionStorage.setItem("northstar-cart", JSON.stringify(cart)); }
function addToCart(id) {
  const cart = readCart();
  const existing = cart.find(item => item.id === id);
  if (existing) existing.quantity = Math.min(20, existing.quantity + 1);
  else cart.push({ id, quantity: 1 });
  saveCart(cart);
  toast("Added to your cart.");
  productDialog.close();
  renderCartButton();
}
function renderCartButton() {
  const count = readCart().reduce((sum, item) => sum + item.quantity, 0);
  let button = document.querySelector("#cartBtn");
  if (!button) {
    button = document.createElement("button");
    button.id = "cartBtn";
    button.className = "button small";
    button.addEventListener("click", checkout);
    document.querySelector(".account").prepend(button);
  }
  button.textContent = `Cart (${count})`;
}
async function checkout() {
  const cart = readCart();
  if (!cart.length) return toast("Your cart is empty.");
  if (!currentUser) {
    toast("Log in before placing an order.");
    openAuth("login");
    return;
  }
  const total = cart.reduce((sum, item) => {
    const product = products.find(p => p.id === item.id);
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);
  if (!confirm(`Place order for ${money(total)}?`)) return;
  try {
    const result = await api("/api/orders", { method:"POST", body:JSON.stringify({ items:cart }) });
    saveCart([]);
    renderCartButton();
    toast(`Order #${result.orderId} placed.`);
    await loadOrders();
    document.querySelector("#orders").scrollIntoView({ behavior:"smooth" });
  } catch (err) { toast(err.message); }
}
async function loadOrders() {
  const area = document.querySelector("#ordersList");
  if (!currentUser) { area.innerHTML = "<p>Log in to see your orders.</p>"; return; }
  try {
    const orders = await api("/api/orders");
    area.innerHTML = orders.length ? orders.map(order => {
      const items = JSON.parse(order.items);
      return `<div class="order-row"><div><strong>Order #${order.id}</strong><small>${items.map(i => `${escapeHtml(i.name)} × ${i.quantity}`).join(", ")} · ${new Date(order.created_at + "Z").toLocaleDateString()}</small></div><strong>${money(order.total)}</strong></div>`;
    }).join("") : "<p>No orders yet. Your first order will appear here.</p>";
  } catch { area.innerHTML = "<p>Could not load orders.</p>"; }
}
function openAuth(mode) {
  authMode = mode;
  document.querySelector("#authTitle").textContent = mode === "login" ? "Welcome back" : "Create your account";
  document.querySelector("#authSubmit").textContent = mode === "login" ? "Log in" : "Create account";
  document.querySelector("#nameLabel").hidden = mode === "login";
  document.querySelector("#nameLabel input").required = mode === "register";
  document.querySelector("#switchText").textContent = mode === "login" ? "New here?" : "Already have an account?";
  document.querySelector("#switchAuth").textContent = mode === "login" ? "Create an account" : "Log in";
  document.querySelector("#authError").textContent = "";
  document.querySelector("#authForm").reset();
  authDialog.showModal();
}
document.querySelector("#authBtn").addEventListener("click", () => currentUser ? logout() : openAuth("login"));
document.querySelector("#switchAuth").addEventListener("click", () => openAuth(authMode === "login" ? "register" : "login"));
document.querySelector("#closeAuth").addEventListener("click", () => authDialog.close());
document.querySelector("#closeProduct").addEventListener("click", () => productDialog.close());
document.querySelector("#authForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  try {
    const result = await api(`/api/${authMode}`, { method:"POST", body:JSON.stringify(payload) });
    currentUser = result.user;
    authDialog.close();
    updateAccount();
    await loadOrders();
    toast(authMode === "login" ? "You are logged in." : "Account created.");
  } catch (err) { document.querySelector("#authError").textContent = err.message; }
});
async function logout() {
  await api("/api/logout", { method:"POST", body:"{}" });
  currentUser = null;
  updateAccount();
  loadOrders();
  toast("You have logged out.");
}
function updateAccount() {
  document.querySelector("#welcome").textContent = currentUser ? `Hi, ${currentUser.name}` : "Welcome";
  document.querySelector("#authBtn").textContent = currentUser ? "Log out" : "Log in";
}
(async function start() {
  await loadProducts();
  try { currentUser = (await api("/api/me")).user; } catch {}
  updateAccount();
  await loadOrders();
  renderCartButton();
})();
