// Duck Shop admin page. Only the shop owner can sign in and change gifts.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm";

const BG_REMOVAL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";
const OUT_W = 1200, OUT_H = 900;         // size of saved photos (4:3, like the shop cards; sharp on phones)
const MAX_ENLARGE = 1.5;                 // never stretch a photo more than this (more = blurry)
const ENHANCE_KEY = "duckshop-admin-enhance";

const $ = id => document.getElementById(id);
const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
const bucket = CONFIG.photoBucket || "gift-photos";
const bucketUrl = `${CONFIG.supabaseUrl}/storage/v1/object/public/${bucket}/`;

let gifts = [];
let editing = null;      // gift being edited, or null for a new gift
let photo = null;        // { original: Blob, result: Blob } for the chosen photo
let photoJob = 0;        // ignores old photo work when a new photo is chosen

// ---------- small helpers ----------
function toast(msg, ms = 2200) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), ms);
}
function show(view) {
  ["loginView", "notAdminView", "mainView", "loading"].forEach(v => $(v).hidden = v !== view);
  $("adminNav").hidden = view !== "mainView";
}
function friendly(err) {
  const m = (err && (err.message || err.error_description || String(err))) || "Something went wrong";
  if (/Invalid login/i.test(m)) return "Wrong email or password.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "No internet connection, or Supabase is sleeping. Try again in a minute.";
  if (/row-level security|permission denied/i.test(m)) return "You are not allowed to do this. Please sign in again.";
  return m;
}
function slug(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "gift";
}
function imgSrc(g) { return g.image || "assets/duck.svg"; }

// ---------- sign in / out ----------
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { show("loginView"); return; }
  const { data: isAdmin, error } = await sb.rpc("is_admin");
  if (error) { show("loginView"); $("loginError").textContent = friendly(error); return; }
  if (!isAdmin) { show("notAdminView"); return; }
  show("mainView");
  await loadGifts();
}

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("loginError").textContent = "";
  const btn = e.submitter; btn.disabled = true; btn.textContent = "Signing in…";
  const { error } = await sb.auth.signInWithPassword({ email: $("loginEmail").value.trim(), password: $("loginPassword").value });
  btn.disabled = false; btn.textContent = "Sign in";
  if (error) { $("loginError").textContent = friendly(error); return; }
  $("loginPassword").value = "";
  start();
});
async function signOut() { await sb.auth.signOut(); show("loginView"); }
$("signOutBtn").onclick = signOut;
$("notAdminOut").onclick = signOut;

// ---------- gift list ----------
async function loadGifts() {
  const { data, error } = await sb.from("gifts").select("*").order("id");
  if (error) { toast(friendly(error), 4000); return; }
  gifts = data;
  $("importBox").hidden = gifts.length > 0;
  $("catList").innerHTML = "";
  [...new Set(gifts.map(g => g.category))].sort().forEach(c => {
    const o = document.createElement("option"); o.value = c; $("catList").appendChild(o);
  });
  renderList();
}

function renderList() {
  const q = $("adminSearch").value.trim().toLowerCase();
  const list = gifts.filter(g => !q || [g.name, g.category, g.description].join(" ").toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const out = gifts.filter(g => g.stock < 1).length, hid = gifts.filter(g => g.hidden).length;
  $("adminCount").textContent = `${gifts.length} gifts · ${out} out of stock · ${hid} hidden`;
  const box = $("giftList"); box.innerHTML = "";
  if (!list.length && gifts.length) box.innerHTML = '<p class="muted">No gifts match your search.</p>';
  list.forEach(g => box.appendChild(row(g)));
}
$("adminSearch").addEventListener("input", renderList);

function row(g) {
  const r = document.createElement("article");
  r.className = "g-row" + (g.hidden ? " is-hidden" : "") + (g.stock < 1 ? " is-out" : "");
  const img = new Image(); img.alt = ""; img.loading = "lazy"; img.src = imgSrc(g);
  img.onerror = () => { img.onerror = null; img.src = "assets/duck.svg"; };

  const info = document.createElement("div"); info.className = "g-info";
  const b = document.createElement("b"); b.textContent = g.name;
  const sm = document.createElement("small"); sm.textContent = `${g.category} · ${g.points} Ducks`;
  const badges = document.createElement("div"); badges.className = "g-badges";
  const st = document.createElement("span"); st.className = "tag" + (g.stock < 1 ? " out" : "");
  st.textContent = g.stock < 1 ? "Out of stock" : `${g.stock} left`;
  badges.appendChild(st);
  if (g.hidden) { const h = document.createElement("span"); h.className = "tag"; h.textContent = "Hidden"; badges.appendChild(h); }
  info.append(b, sm, badges);

  const act = document.createElement("div"); act.className = "g-actions";
  const stock = document.createElement("div"); stock.className = "stock";
  const minus = btn("−", "", () => setStock(g, g.stock - 1)); minus.setAttribute("aria-label", `One less ${g.name}`);
  const num = document.createElement("span"); num.textContent = g.stock;
  const plus = btn("+", "", () => setStock(g, g.stock + 1)); plus.setAttribute("aria-label", `One more ${g.name}`);
  minus.disabled = g.stock < 1;
  stock.append(minus, num, plus);
  const sold = btn("Sold out", "ghost", () => setStock(g, 0)); sold.disabled = g.stock < 1;
  const edit = btn("Edit", "ghost", () => openEditor(g));
  const del = btn("Delete", "danger", () => removeGift(g));
  act.append(stock, sold, edit, del);

  r.append(img, info, act);
  return r;
}
function btn(text, cls, onclick) {
  const b = document.createElement("button"); b.type = "button"; b.textContent = text;
  if (cls) b.className = cls; b.onclick = onclick; return b;
}

async function setStock(g, n) {
  n = Math.max(0, n);
  const old = g.stock; g.stock = n; renderList();
  const { error } = await sb.from("gifts").update({ stock: n }).eq("id", g.id);
  if (error) { g.stock = old; renderList(); toast(friendly(error), 4000); return; }
  toast(n < 1 ? `${g.name} is now out of stock` : `${g.name}: ${n} left`);
}

async function removeGift(g) {
  if (!confirm(`Delete "${g.name}" from the shop? This cannot be undone.`)) return;
  const { error } = await sb.from("gifts").delete().eq("id", g.id);
  if (error) { toast(friendly(error), 4000); return; }
  await deletePhoto(g.image);
  toast(`${g.name} deleted`);
  loadGifts();
}

// ---------- photos ----------
function storagePath(url) { return url && url.startsWith(bucketUrl) ? decodeURIComponent(url.slice(bucketUrl.length)) : null; }
async function deletePhoto(url) {
  const p = storagePath(url);
  if (p) await sb.storage.from(bucket).remove([p]);
}
async function uploadPhoto(blob, name) {
  const path = `gifts/${Date.now()}-${slug(name)}.jpg`;
  const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
  if (error) throw error;
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

async function bitmapOf(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch { return await createImageBitmap(blob); }
}
function canvasToJpeg(canvas, q = 0.86) {
  return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("Could not save the photo")), "image/jpeg", q));
}

// Resize an image (or part of it) smoothly: big reductions are done in halves,
// so fine details stay sharp instead of turning jagged or blurry.
function scaledCanvas(src, sx, sy, sw, sh, dw, dh) {
  dw = Math.max(1, Math.round(dw)); dh = Math.max(1, Math.round(dh));
  let cur = src, cx = sx, cy = sy, cw = sw, ch = sh;
  while (cw / 2 >= dw && ch / 2 >= dh) {
    const half = document.createElement("canvas");
    half.width = Math.round(cw / 2); half.height = Math.round(ch / 2);
    const hx = half.getContext("2d"); hx.imageSmoothingQuality = "high";
    hx.drawImage(cur, cx, cy, cw, ch, 0, 0, half.width, half.height);
    cur = half; cx = 0; cy = 0; cw = half.width; ch = half.height;
  }
  const out = document.createElement("canvas"); out.width = dw; out.height = dh;
  const ox = out.getContext("2d"); ox.imageSmoothingQuality = "high";
  ox.drawImage(cur, cx, cy, cw, ch, 0, 0, dw, dh);
  return out;
}

// The soft duck-colored studio backdrop (warm cream in the middle, butter-yellow edges).
function studioBackdrop() {
  const c = document.createElement("canvas"); c.width = OUT_W; c.height = OUT_H;
  const x = c.getContext("2d");
  const bg = x.createRadialGradient(OUT_W / 2, OUT_H * 0.42, 30, OUT_W / 2, OUT_H * 0.5, OUT_W * 0.78);
  bg.addColorStop(0, "#FFFEF8"); bg.addColorStop(0.5, "#FFF6DA"); bg.addColorStop(1, "#FBE3A0");
  x.fillStyle = bg; x.fillRect(0, 0, OUT_W, OUT_H);
  return { c, x };
}

// Without editing: keep the photo as it is, but always in the shop's 4:3 shape
// (the whole photo fits inside; never cut, never stretched more than 1.5x).
async function plainPhoto(file) {
  const bmp = await bitmapOf(file);
  const k = Math.min(OUT_W / bmp.width, OUT_H / bmp.height, MAX_ENLARGE);
  const dw = bmp.width * k, dh = bmp.height * k;
  const { c, x } = studioBackdrop();
  x.drawImage(scaledCanvas(bmp, 0, 0, bmp.width, bmp.height, dw, dh), Math.round((OUT_W - dw) / 2), Math.round((OUT_H - dh) / 2));
  return canvasToJpeg(c, 0.9);
}

let bgLib = null;
async function studioPhoto(file, onStatus) {
  // 1) shrink very big phone photos (max 2000px) so it runs faster but stays sharp
  const bmp = await bitmapOf(file);
  const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const pre = scaledCanvas(bmp, 0, 0, bmp.width, bmp.height, bmp.width * s, bmp.height * s);
  const small = await new Promise(r => pre.toBlob(r, "image/png"));

  // 2) remove the background (runs in this browser; first time downloads the tool, ~40 MB)
  onStatus("Getting the photo tool ready… (the first time can take up to a minute)");
  bgLib = bgLib || await import(BG_REMOVAL);
  onStatus("Removing the background…");
  const cutBlob = await bgLib.removeBackground(small, {
    model: "isnet_fp16",
    output: { format: "image/png" },
    progress: (key, cur, total) => {
      if (key.startsWith("fetch") && total && cur < total) onStatus(`Getting the photo tool ready… ${Math.round(cur / total * 100)}%`);
      else onStatus("Removing the background… (about 10 to 30 seconds)");
    }
  });
  const cut = await bitmapOf(cutBlob);

  // 3) find where the product is (ignore almost-transparent pixels)
  const tc = document.createElement("canvas"); tc.width = cut.width; tc.height = cut.height;
  const tx = tc.getContext("2d"); tx.drawImage(cut, 0, 0);
  const a = tx.getImageData(0, 0, cut.width, cut.height).data;
  let x0 = cut.width, y0 = cut.height, x1 = -1, y1 = -1;
  for (let y = 0; y < cut.height; y++) for (let x = 0; x < cut.width; x++) {
    if (a[(y * cut.width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new Error("Could not find the product in this photo. Try turning off automatic editing.");
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

  // 4) soft duck-colored studio backdrop with a gentle "floor"
  const { c, x } = studioBackdrop();
  const floor = x.createLinearGradient(0, OUT_H * 0.64, 0, OUT_H);
  floor.addColorStop(0, "rgba(255,255,255,0)"); floor.addColorStop(1, "rgba(240,196,92,.30)");
  x.fillStyle = floor; x.fillRect(0, OUT_H * 0.64, OUT_W, OUT_H * 0.36);

  // 5) place the product (untouched, same proportions) in the middle, standing on the "floor".
  //    Tall products (or rotated photos) fit by height, wide ones by width; never stretched more than 1.5x.
  const k = Math.min((OUT_W * 0.8) / bw, (OUT_H * 0.78) / bh, MAX_ENLARGE);
  const dw = bw * k, dh = bh * k, dx = Math.round((OUT_W - dw) / 2), dy = Math.round(OUT_H * 0.9 - dh);
  x.save();
  x.filter = "blur(18px)"; x.fillStyle = "rgba(120,80,10,.22)";
  x.beginPath(); x.ellipse(OUT_W / 2, dy + dh - 2, dw * 0.42, Math.max(10, dh * 0.045), 0, 0, Math.PI * 2); x.fill();
  x.restore();
  x.drawImage(scaledCanvas(cut, x0, y0, bw, bh, dw, dh), dx, dy);
  return canvasToJpeg(c, 0.9);
}

function previewBlob(blob) {
  const box = $("photoPreview"); box.innerHTML = "";
  if (!blob) { box.innerHTML = '<span class="muted">No photo yet</span>'; return; }
  const img = new Image(); img.alt = "Photo preview"; img.src = URL.createObjectURL(blob);
  img.onload = () => URL.revokeObjectURL(img.src);
  box.appendChild(img);
}
function previewUrl(url) {
  const box = $("photoPreview"); box.innerHTML = "";
  const img = new Image(); img.alt = "Current photo"; img.src = url; box.appendChild(img);
}

let chosenFile = null;   // last photo taken with the camera or picked from the gallery
let rotation = 0;        // 0, 90, 180 or 270 degrees (clockwise)

// Turn the photo a quarter (or half) turn. A quarter turn swaps width and height exactly,
// so nothing is cut or squeezed. Saved as PNG so no quality is lost before editing.
async function rotateBlob(blob, deg) {
  const bmp = await bitmapOf(blob);
  const side = deg % 180 !== 0;
  const c = document.createElement("canvas");
  c.width = side ? bmp.height : bmp.width; c.height = side ? bmp.width : bmp.height;
  const x = c.getContext("2d");
  x.translate(c.width / 2, c.height / 2); x.rotate(deg * Math.PI / 180);
  x.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("Could not turn the photo")), "image/png"));
}

async function rotate(step) {
  if (!chosenFile) {
    // Rotating the photo a gift already has: start from that photo.
    if (!editing || !editing.image) return;
    try {
      $("photoStatus").textContent = "Opening the current photo…";
      const res = await fetch(imgSrc(editing), { cache: "no-store" });
      if (!res.ok) throw new Error("Could not open the current photo.");
      chosenFile = await res.blob();
    } catch (err) { $("photoStatus").textContent = friendly(err); return; }
  }
  rotation = (rotation + step + 360) % 360;
  preparePhoto();
}
$("rotLeft").onclick = () => rotate(-90);
$("rotRight").onclick = () => rotate(90);

async function preparePhoto() {
  if (!chosenFile) return;
  const file = rotation ? await rotateBlob(chosenFile, rotation) : chosenFile;
  const job = ++photoJob;
  const enhance = $("enhanceToggle").checked;
  photo = { original: file, result: null };
  previewBlob(file);
  $("viewSeg").hidden = true;
  $("saveBtn").disabled = true;
  const status = m => { if (job === photoJob) $("photoStatus").textContent = m; };
  try {
    status(enhance ? "Working on the photo…" : "Preparing the photo…");
    const result = enhance ? await studioPhoto(file, status) : await plainPhoto(file);
    if (job !== photoJob) return;
    photo.result = result;
    previewBlob(result);
    $("viewSeg").hidden = !enhance;
    setSeg("result");
    status(enhance ? "Done! Check the edited photo. Not happy? Untick “Make the photo pretty” to use the original." : "Photo ready.");
  } catch (err) {
    if (job !== photoJob) return;
    console.error(err);
    photo.result = null;
    status("Sorry, automatic editing didn't work for this photo: " + friendly(err) + " Untick “Make the photo pretty” and choose the photo again.");
  } finally {
    if (job === photoJob) $("saveBtn").disabled = false;
  }
}
["photoInput", "cameraInput"].forEach(id => $(id).addEventListener("change", e => {
  const f = e.target.files[0]; e.target.value = "";
  if (f) { chosenFile = f; rotation = 0; $("rotateRow").hidden = false; preparePhoto(); }
}));
$("enhanceToggle").addEventListener("change", () => {
  try { localStorage.setItem(ENHANCE_KEY, $("enhanceToggle").checked ? "1" : "0"); } catch {}
  if (chosenFile) preparePhoto();
});
function setSeg(v) {
  document.querySelectorAll("#viewSeg button").forEach(b => b.classList.toggle("on", b.dataset.view === v));
}
document.querySelectorAll("#viewSeg button").forEach(b => b.onclick = () => {
  if (!photo) return;
  setSeg(b.dataset.view);
  previewBlob(b.dataset.view === "original" ? photo.original : photo.result);
});

// ---------- add / edit ----------
function openEditor(g = null) {
  editing = g; photo = null; chosenFile = null; rotation = 0; photoJob++;
  $("rotateRow").hidden = !(g && g.image);
  $("editForm").reset();
  try { $("enhanceToggle").checked = localStorage.getItem(ENHANCE_KEY) !== "0"; } catch {}
  $("editorTitle").textContent = g ? `Edit ${g.name}` : "Add a gift";
  $("saveBtn").textContent = g ? "Save changes" : "Publish";
  $("saveBtn").disabled = false;
  $("editError").textContent = ""; $("photoStatus").textContent = ""; $("viewSeg").hidden = true;
  $("fName").value = g ? g.name : "";
  $("fDesc").value = g ? g.description : "";
  $("fCat").value = g ? g.category : "";
  $("fPoints").value = g ? g.points : "";
  $("fStock").value = g ? g.stock : 1;
  $("fHidden").checked = g ? g.hidden : false;
  if (g && g.image) previewUrl(imgSrc(g)); else previewBlob(null);
  $("editor").showModal();
}
$("addBtn").onclick = () => openEditor();
$("editorClose").onclick = $("editorCancel").onclick = () => { photoJob++; $("editor").close(); };

$("editForm").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("editError"); err.textContent = "";
  const name = $("fName").value.trim().replace(/\s+/g, " ");
  const data = {
    name,
    description: $("fDesc").value.trim(),
    category: $("fCat").value.trim().replace(/\s+/g, " "),
    points: parseInt($("fPoints").value, 10),
    stock: parseInt($("fStock").value, 10),
    hidden: $("fHidden").checked
  };
  if (!name) { err.textContent = "Please type the gift name."; return; }
  if (!data.category) { err.textContent = "Please type a category."; return; }
  if (!(data.points >= 0)) { err.textContent = "Please type the price in Ducks."; return; }
  if (!(data.stock >= 0)) { err.textContent = "Please type how many you have (0 = out of stock)."; return; }
  if (!editing && !(photo && photo.result)) { err.textContent = "Please choose a photo first."; return; }
  if (photo && !photo.result) { err.textContent = "Please wait until the photo is ready (or untick “Make the photo pretty”)."; return; }

  const save = $("saveBtn"); save.disabled = true; save.textContent = "Saving…";
  let newUrl = null;
  try {
    if (photo && photo.result) newUrl = data.image = await uploadPhoto(photo.result, name);
    const q = editing ? sb.from("gifts").update(data).eq("id", editing.id) : sb.from("gifts").insert(data);
    const { error } = await q;
    if (error) throw error;
    if (editing && newUrl && editing.image !== newUrl) await deletePhoto(editing.image);
    $("editor").close();
    toast(editing ? "Saved! The shop is updated." : `${name} is now in the shop 🦆`);
    loadGifts();
  } catch (ex) {
    if (newUrl) await deletePhoto(newUrl);
    err.textContent = friendly(ex);
  } finally {
    save.disabled = false; save.textContent = editing ? "Save changes" : "Publish";
  }
});

// ---------- one-time import of the starter gifts ----------
$("importBtn").onclick = async () => {
  const b = $("importBtn"); b.disabled = true; b.textContent = "Importing…";
  try {
    const res = await fetch("gifts.json", { cache: "no-store" });
    const starter = await res.json();
    const rows = starter.map(({ name, description, category, points, stock, image }) =>
      ({ name, description: description || "", category: category || "Other", points, stock, image: image || null }));
    const { error } = await sb.from("gifts").insert(rows);
    if (error) throw error;
    toast(`${rows.length} gifts imported 🎉`);
    loadGifts();
  } catch (ex) {
    toast(friendly(ex), 5000);
  } finally {
    b.disabled = false; b.textContent = "Import my starter gifts";
  }
};

// ---------- re-edit existing photos, one by one, with a check ----------
const rev = { queue: [], i: 0, kept: 0, used: 0, job: 0, result: null };

function revShow(part) { ["revStart", "revWork", "revDone"].forEach(p => $(p).hidden = p !== part); }
$("reeditBtn").onclick = () => { revShow("revStart"); $("reviewer").showModal(); };
$("revClose").onclick = $("revFinish").onclick = () => { rev.job++; $("reviewer").close(); loadGifts(); };
$("revStop").onclick = () => { rev.job++; revFinish(); };

$("revGo").onclick = () => {
  const only = $("revOnlyStarter").checked;
  rev.queue = gifts.filter(g => g.image && (!only || g.image.startsWith("assets/images/")))
    .sort((a, b) => a.name.localeCompare(b.name));
  rev.i = 0; rev.kept = 0; rev.used = 0; rev.failed = []; rev.auto = $("revAuto").checked;
  if (!rev.queue.length) { revFinish("There are no photos to re-edit."); return; }
  revShow("revWork");
  revItem();
};

async function revItem(sourceFile = null) {
  if (rev.i >= rev.queue.length) { revFinish(); return; }
  const g = rev.queue[rev.i], job = ++rev.job;
  rev.result = null;
  $("revProgress").textContent = `Photo ${rev.i + 1} of ${rev.queue.length}`;
  $("revName").textContent = g.name;
  $("revOld").src = imgSrc(g);
  $("revNewBox").innerHTML = '<span class="muted">Working…</span>';
  $("revUse").disabled = true;
  const status = m => { if (job === rev.job) $("revStatus").textContent = m; };
  try {
    let src = sourceFile;
    if (!src) {
      const res = await fetch(imgSrc(g), { cache: "no-store" });
      if (!res.ok) throw new Error("Could not open the old photo.");
      src = await res.blob();
    }
    status("Working on the photo…");
    const out = await studioPhoto(src, status);
    if (job !== rev.job) return;
    rev.result = out;
    const img = new Image(); img.alt = "New photo"; img.src = URL.createObjectURL(out);
    $("revNewBox").innerHTML = ""; $("revNewBox").appendChild(img);
    $("revUse").disabled = false;
    if (rev.auto) { status("Saving…"); $("revUse").click(); return; }
    status("Which one do you like more?");
  } catch (err) {
    if (job !== rev.job) return;
    console.error(err);
    $("revNewBox").innerHTML = '<span class="muted">No new photo</span>';
    if (rev.auto) { rev.failed.push(g.name); rev.kept++; rev.i++; revItem(); return; }
    status("This one didn't work: " + friendly(err) + " Press “Keep old” or “Use a different photo”.");
  }
}

$("revUse").onclick = async () => {
  const g = rev.queue[rev.i]; if (!rev.result) return;
  const b = $("revUse"); b.disabled = true; b.textContent = "Saving…";
  try {
    const url = await uploadPhoto(rev.result, g.name);
    const { error } = await sb.from("gifts").update({ image: url }).eq("id", g.id);
    if (error) { await deletePhoto(url); throw error; }
    await deletePhoto(g.image);
    g.image = url; rev.used++;
    rev.i++; revItem();
  } catch (err) {
    if (rev.auto) { rev.failed.push(g.name); rev.kept++; rev.i++; revItem(); return; }
    $("revStatus").textContent = friendly(err);
    b.disabled = false;
  } finally { b.textContent = "Use new photo"; }
};
$("revKeep").onclick = () => { rev.kept++; rev.i++; revItem(); };
["revFile", "revCamera"].forEach(id => $(id).addEventListener("change", e => {
  const f = e.target.files[0]; e.target.value = "";
  if (f) revItem(f);
}));

function revFinish(msg) {
  revShow("revDone");
  $("revSummary").textContent = msg || `Finished! ${rev.used} new photo${rev.used === 1 ? "" : "s"} saved, ${rev.kept} kept as before.` +
    (rev.failed && rev.failed.length ? ` These didn't work and kept their old photo: ${rev.failed.join(", ")}.` : "");
}

// ---------- backup ----------
$("backupBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(gifts, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `duck-shop-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Backup downloaded. Keep it with your original photos.");
};

// Keep the photo tool on this device after the first download.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("photo-tool-cache.js").catch(() => {});

sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT") show("loginView"); });
start().catch(err => { show("loginView"); $("loginError").textContent = friendly(err); });
