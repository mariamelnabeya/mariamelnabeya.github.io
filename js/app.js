const $ = id => document.getElementById(id);
const KEY = "duckshop-selection";
let gifts = [];
let cart = {}; // id -> quantity

function loadCart() {
  try { cart = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { cart = {}; }
}
function saveCart() {
  try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch {}
}
// Short message at the bottom. Disappears after 5 seconds (or when tapped).
// A new message restarts the 5 seconds instead of stacking timers.
const TOAST_MS = 5000;
let toastTimer = 0;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), TOAST_MS);
}
$("toast").addEventListener("click", () => { clearTimeout(toastTimer); $("toast").classList.remove("show"); });

// Gifts come from Supabase (kept up to date from the admin page).
// If Supabase can't be reached, the shop shows the starter list in gifts.json.
async function loadGifts() {
  if (CONFIG.supabaseUrl && CONFIG.supabaseKey) {
    try {
      const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/gifts?select=id,name,description,category,points,stock,image&hidden=eq.false&order=id`,
        { headers: { apikey: CONFIG.supabaseKey }, cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const list = await res.json();
      if (list.length) return list;
    } catch (e) { console.warn("Supabase not reachable, using gifts.json", e); }
  }
  const res = await fetch("gifts.json");
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

async function init() {
  loadCart();
  try {
    gifts = await loadGifts();
  } catch {
    $("status").textContent = "Sorry, the gifts could not be loaded. Please check your internet and refresh the page.";
    return;
  }
  Object.keys(cart).forEach(id => { const g = gifts.find(x => String(x.id) === id); if (!g || g.stock < 1) delete cart[id]; else cart[id] = Math.min(cart[id], g.stock); });
  [...new Set(gifts.map(g => g.category))].sort().forEach(c => {
    const o = document.createElement("option"); o.value = c; o.textContent = c; $("category").appendChild(o);
  });
  ["search", "sort", "stock", "category"].forEach(id => $(id).addEventListener("input", renderGrid));
  renderGrid(); renderCart();
}

function renderGrid() {
  const q = $("search").value.trim().toLowerCase();
  const stock = $("stock").value, cat = $("category").value, sort = $("sort").value;
  let list = gifts.filter(g =>
    (!q || [g.name, g.description, g.category].join(" ").toLowerCase().includes(q)) &&
    (stock === "all" || (stock === "in") === (g.stock > 0)) &&
    (cat === "all" || g.category === cat));
  const by = {
    "points-asc": (a, b) => a.points - b.points, "points-desc": (a, b) => b.points - a.points,
    "name-asc": (a, b) => a.name.localeCompare(b.name), "name-desc": (a, b) => b.name.localeCompare(a.name)
  }[sort];
  list.sort(by);
  $("status").textContent = list.length ? `${list.length} gift${list.length === 1 ? "" : "s"}` : "";
  const grid = $("grid"); grid.innerHTML = "";
  if (!list.length) { grid.innerHTML = gifts.length ? '<p class="empty">No gifts match. Try a different word or clear the filters.</p>' : '<p class="empty">New gifts are coming soon 🦆</p>'; return; }
  list.forEach(g => {
    const card = document.createElement("article"); card.className = "card";
    const thumb = document.createElement("div"); thumb.className = "thumb";
    const img = new Image(); img.alt = g.name; img.loading = "lazy"; img.decoding = "async";
    img.onerror = () => { img.onerror = null; img.src = "assets/duck.svg"; img.classList.add("ph"); };
    img.src = g.image || "missing";
    thumb.appendChild(img);
    thumb.tabIndex = 0; thumb.setAttribute("role", "button"); thumb.setAttribute("aria-label", `See ${g.name} bigger`);
    thumb.onclick = () => openPhoto(g);
    thumb.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPhoto(g); } };
    const body = document.createElement("div"); body.className = "body";
    const h = document.createElement("h3"); h.textContent = g.name;
    const p = document.createElement("p"); p.textContent = g.description;
    const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = g.category;
    const av = document.createElement("span"); av.className = "tag" + (g.stock > 0 ? "" : " out"); av.textContent = g.stock > 0 ? (g.stock <= 3 ? `Only ${g.stock} left` : `${g.stock} left`) : "Out of stock";
    const pr = document.createElement("div"); pr.className = "price"; pr.textContent = `${g.points} Ducks`;
    const btn = document.createElement("button"); btn.className = "primary"; btn.textContent = g.stock > 0 ? "Add to Cart" : "Out of stock";
    btn.disabled = !(g.stock > 0);
    btn.onclick = () => addOne(g);
    body.append(tag, h, p, av, pr, btn);
    card.append(thumb, body); grid.appendChild(card);
  });
}

function addOne(g) {
  if ((cart[g.id] || 0) >= g.stock) { toast(`That is all we have of ${g.name}`); return; }
  cart[g.id] = (cart[g.id] || 0) + 1; saveCart(); renderCart(); toast(`${g.name} added to your cart`);
  const fab = $("cartFab"); fab.classList.remove("bump"); void fab.offsetWidth; fab.classList.add("bump");
}

// Big photo view (tap a gift photo)
function openPhoto(g) {
  const big = $("photoBig");
  big.onerror = () => { big.onerror = null; big.src = "assets/duck.svg"; };
  big.src = g.image || "assets/duck.svg"; big.alt = g.name;
  $("photoName").textContent = g.name;
  $("photoDesc").textContent = g.description || "";
  $("photoPrice").textContent = `${g.points} Ducks`;
  const st = $("photoStock");
  st.className = "tag" + (g.stock > 0 ? "" : " out");
  st.textContent = g.stock > 0 ? (g.stock <= 3 ? `Only ${g.stock} left` : `${g.stock} left`) : "Out of stock";
  $("photoAdd").disabled = !(g.stock > 0);
  $("photoAdd").onclick = () => { addOne(g); $("photoView").close(); };
  $("photoView").showModal();
}
$("photoClose").onclick = () => $("photoView").close();
$("photoView").addEventListener("click", e => { if (e.target === $("photoView")) $("photoView").close(); });

function cartLines() {
  return Object.entries(cart).map(([id, qty]) => ({ g: gifts.find(x => String(x.id) === id), qty })).filter(l => l.g);
}
function renderCart() {
  const lines = cartLines(), box = $("items"); box.innerHTML = "";
  let n = 0, pts = 0;
  if (!lines.length) box.innerHTML = '<p class="empty">Your cart is empty. Tap “Add to Cart” on a gift.</p>';
  lines.forEach(({ g, qty }) => {
    n += qty; pts += qty * g.points;
    const row = document.createElement("div"); row.className = "item";
    const t = document.createElement("div"); t.innerHTML = "<b></b><br><small></small>";
    t.querySelector("b").textContent = g.name; t.querySelector("small").textContent = `${g.points} Ducks each = ${g.points * qty} Ducks`;
    const q = document.createElement("div"); q.className = "qty";
    const minus = document.createElement("button"); minus.textContent = "−"; minus.setAttribute("aria-label", "Decrease");
    const num = document.createElement("span"); num.textContent = qty;
    const plus = document.createElement("button"); plus.textContent = "+"; plus.setAttribute("aria-label", "Increase");
    minus.onclick = () => { cart[g.id] = qty - 1; if (cart[g.id] < 1) delete cart[g.id]; saveCart(); renderCart(); };
    plus.onclick = () => { if (qty >= g.stock) { toast(`That is all we have of ${g.name}`); return; } cart[g.id] = qty + 1; saveCart(); renderCart(); };
    q.append(minus, num, plus);
    const rm = document.createElement("button"); rm.className = "rm"; rm.textContent = "Remove";
    rm.onclick = () => { delete cart[g.id]; saveCart(); renderCart(); };
    row.append(t, q, rm); box.appendChild(row);
  });
  $("totalGifts").textContent = n; $("totalPoints").textContent = pts;
  $("cartCount").textContent = n; $("submitBtn").disabled = !n;
  $("fabCount").textContent = n;
  $("cartFab").hidden = !n;
  $("cartFab").setAttribute("aria-label", `Open my cart, ${n} item${n === 1 ? "" : "s"}`);
  document.body.classList.toggle("has-fab", n > 0);
}

function openCart(open) {
  $("drawer").classList.toggle("open", open); $("overlay").classList.toggle("show", open);
  $("drawer").setAttribute("aria-hidden", String(!open));
}
$("openCart").onclick = $("cartFab").onclick = () => openCart(true);
$("closeCart").onclick = $("overlay").onclick = () => openCart(false);
$("clearBtn").onclick = () => { cart = {}; saveCart(); renderCart(); };
$("submitBtn").onclick = () => { $("nameError").textContent = ""; $("nameDialog").showModal(); $("nameInput").focus(); };
$("nameCancel").onclick = () => $("nameDialog").close();

function makeRef() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let r = "";
  for (let i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return CONFIG.refPrefix + r;
}
function buildMessage(name, ref) {
  const lines = cartLines();
  const n = lines.reduce((s, l) => s + l.qty, 0), pts = lines.reduce((s, l) => s + l.qty * l.g.points, 0);
  return [`🦆 ${CONFIG.hashtag}`, `Order ref: ${ref}`, `Name: ${name}`, "", "Gifts:",
    ...lines.map(l => `• ${l.g.name} x${l.qty} = ${l.qty * l.g.points} Ducks`), "",
    `Total gifts: ${n}`, `Total Ducks: ${pts}`].join("\n");
}

// ---- Send the request ----
// Opens WhatsApp with the message, and at the same time saves the request to the owner's
// Requests list (name + gifts + order number, never a phone number). No questions for the girl.
function saveRequest(ref, name, items) {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) return;
  // keepalive lets the save finish even while the phone switches to WhatsApp
  fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/submit_request`, {
    method: "POST", keepalive: true,
    headers: { apikey: CONFIG.supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ p_ref: ref, p_name: name, p_items: items })
  }).catch(e => console.warn("Request not saved", e));
}

$("nameForm").addEventListener("submit", e => {
  e.preventDefault();
  const name = $("nameInput").value.trim().replace(/\s+/g, " ");
  if (name.length < 2) { $("nameError").textContent = "Please enter your name (at least 2 letters)."; return; }
  const ref = makeRef();
  const url = `https://wa.me/${CONFIG.whatsappNumber}?text=${encodeURIComponent(buildMessage(name, ref))}`;
  const items = cartLines().map(l => ({ id: l.g.id, qty: l.qty }));
  window.open(url, "_blank", "noopener");   // first, so phones don't block it
  saveRequest(ref, name, items);
  cart = {}; saveCart(); renderCart(); openCart(false);
  $("nameDialog").close();
  toast("WhatsApp opened. Press Send there to finish your request 🦆");
});
try { localStorage.removeItem("duckshop-pending"); } catch {}
init();
