// Duck Shop admin page. Only the shop owner can sign in and change gifts.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm";

const BG_REMOVAL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";
const BG_MODEL = "isnet_quint8";         // the lighter version of the tool: half the download and memory, faster on phones
const ASSET_VERSION = new URL(import.meta.url).searchParams.get("v") || "1";
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
// Short message at the bottom: every message shows for 5 seconds (tap it to close sooner).
const TOAST_MS = 5000;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), TOAST_MS);
}
$("toast").addEventListener("click", () => { clearTimeout(toast.t); $("toast").classList.remove("show"); });
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
  refreshNewBadge();
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
  if (error) { toast(friendly(error)); return; }
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
  const img = new Image(); img.alt = ""; img.loading = "lazy"; img.decoding = "async"; img.src = imgSrc(g);
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
  if (error) { g.stock = old; renderList(); toast(friendly(error)); return; }
  toast(n < 1 ? `${g.name} is now out of stock` : `${g.name}: ${n} left`);
}

async function removeGift(g) {
  if (!confirm(`Delete "${g.name}" from the shop? This cannot be undone.`)) return;
  const { error } = await sb.from("gifts").delete().eq("id", g.id);
  if (error) { toast(friendly(error)); return; }
  await deletePhoto(g.image);
  await deletePhoto(g.original_image);
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

// ---- The background-removal tool runs in the background (a Web Worker) ----
// so the page never freezes while a photo is edited. If this browser can't run it
// in the background, it falls back to running it on the page (slower, may freeze).
let photoWorker = null, workerBroken = false, workerSeq = 0, bgLib = null;
const workerJobs = new Map();
function getWorker() {
  if (photoWorker || workerBroken) return photoWorker;
  try {
    photoWorker = new Worker(new URL("photo-worker.js?v=" + ASSET_VERSION, import.meta.url), { type: "module" });
    photoWorker.onmessage = e => {
      const job = workerJobs.get(e.data.id); if (!job) return;
      if (e.data.progress) { job.onProgress(e.data.progress); return; }
      workerJobs.delete(e.data.id);
      e.data.error ? job.reject(new Error(e.data.error)) : job.resolve(e.data.result);
    };
    photoWorker.onerror = () => {
      workerBroken = true; photoWorker = null;
      for (const job of workerJobs.values()) job.reject(new Error("WORKER_FAILED"));
      workerJobs.clear();
    };
  } catch { workerBroken = true; photoWorker = null; }
  return photoWorker;
}
async function removeBg(blob, onProgress) {
  const w = getWorker();
  if (w) {
    try {
      return await new Promise((resolve, reject) => {
        const id = ++workerSeq; workerJobs.set(id, { resolve, reject, onProgress });
        w.postMessage({ id, blob, model: BG_MODEL });
      });
    } catch (e) { if (e.message !== "WORKER_FAILED") throw e; }
  }
  bgLib = bgLib || await import(BG_REMOVAL);
  return bgLib.removeBackground(blob, { model: BG_MODEL, output: { format: "image/png" },
    progress: (key, current, total) => onProgress({ key, cur: current, total }) });
}

const WORK_TIME_KEY = "duckshop-bg-seconds";   // how long removing the background took last time on this device
async function studioPhoto(file, onStatus, onPct) {
  let shown = 0;
  const pct = (p, text) => { p = Math.max(shown, Math.min(100, p)); shown = p; if (onPct) onPct(Math.round(p), text); };
  // 1) shrink very big phone photos (max 2000px) so it runs faster but stays sharp
  const bmp = await bitmapOf(file);
  const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const pre = scaledCanvas(bmp, 0, 0, bmp.width, bmp.height, bmp.width * s, bmp.height * s);

  // The tool looks at a copy with stronger contrast and colors, so pale parts of a gift
  // (a white card, a clear bag) stand out from the background and are not erased.
  // The gift itself keeps its real, untouched colors: only the shape is taken from the copy.
  // The copy is at most 1280px: the tool works at about 1000px anyway, so bigger only costs time.
  const gs = Math.min(1, 1280 / Math.max(pre.width, pre.height));
  const guideSrc = scaledCanvas(pre, 0, 0, pre.width, pre.height, pre.width * gs, pre.height * gs);
  const guide = document.createElement("canvas"); guide.width = guideSrc.width; guide.height = guideSrc.height;
  const gx = guide.getContext("2d"); gx.filter = "contrast(1.9) saturate(3) brightness(0.95)"; gx.drawImage(guideSrc, 0, 0);
  const small = await new Promise(r => guide.toBlob(r, "image/jpeg", 0.92));   // JPEG: much faster than PNG, same shape result

  // 2) remove the background (the first time on a device, the tool is downloaded once)
  //    Progress shown to the owner:  5% ready → up to 45% downloading the tool (exact, first time only)
  //    → up to 95% removing the background (estimated from how long it took last time) → 100% done.
  pct(5, "Getting ready…");
  onStatus("The first photo on a new phone takes longer: the photo tool downloads once.");
  const files = new Map(); let downloaded = false, workStart = 0, timer = 0;
  const expected = (() => { try { return Math.min(180, Math.max(8, +localStorage.getItem(WORK_TIME_KEY) || 25)); } catch { return 25; } })();
  const startWork = () => {
    if (workStart) return;
    workStart = performance.now();
    const from = Math.max(downloaded ? 45 : 8, shown);
    onStatus("You can keep typing the name and price while the photo is made.");
    timer = setInterval(() => {   // smooth estimate: grows quickly at first, never passes 95% until really done
      const t = (performance.now() - workStart) / 1000;
      pct(from + (95 - from) * (1 - Math.exp(-1.6 * t / expected)), "Removing the background…");
    }, 250);
  };
  let shapeBlob, waitTimer = setTimeout(startWork, 2000);   // no download news for 2 s = the tool is working
  try {
    shapeBlob = await removeBg(small, ({ key, cur, total }) => {
      if (String(key).startsWith("fetch")) {
        if (workStart || !total) return;
        files.set(key, [cur, total]); downloaded = true;
        let c = 0, t = 0; for (const [a, b] of files.values()) { c += a; t += b; }
        pct(5 + 40 * c / t, "Downloading the photo tool (first time only)…");
        onStatus("");
        clearTimeout(waitTimer); waitTimer = setTimeout(startWork, 2000);
        return;
      }
      clearTimeout(waitTimer); startWork();
    });
  } finally { clearInterval(timer); clearTimeout(waitTimer); }
  if (workStart) { try { localStorage.setItem(WORK_TIME_KEY, String(Math.round((performance.now() - workStart) / 1000))); } catch {} }
  pct(97, "Almost done…");
  const shape = await bitmapOf(shapeBlob);

  // 3) cut the untouched photo with that shape, and find where the product is
  const cut = document.createElement("canvas"); cut.width = pre.width; cut.height = pre.height;
  const cx = cut.getContext("2d");
  const sc = document.createElement("canvas"); sc.width = pre.width; sc.height = pre.height;
  sc.getContext("2d").drawImage(shape, 0, 0, pre.width, pre.height);
  const mask = sc.getContext("2d").getImageData(0, 0, pre.width, pre.height).data;
  const real = pre.getContext("2d").getImageData(0, 0, pre.width, pre.height);
  const a = real.data;
  for (let i = 3; i < a.length; i += 4) a[i] = mask[i];
  cx.putImageData(real, 0, 0);
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
  // soft shadow under the gift: a fading oval (a gradient is much lighter for phones than a blur filter)
  const rx = dw * 0.46, ry = Math.max(12, dh * 0.06), sy = dy + dh - 2;
  x.save();
  x.translate(OUT_W / 2, sy); x.scale(1, ry / rx);
  const sh = x.createRadialGradient(0, 0, 0, 0, 0, rx);
  sh.addColorStop(0, "rgba(120,80,10,.26)"); sh.addColorStop(0.6, "rgba(120,80,10,.12)"); sh.addColorStop(1, "rgba(120,80,10,0)");
  x.fillStyle = sh; x.beginPath(); x.arc(0, 0, rx, 0, Math.PI * 2); x.fill();
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
let crop = null;         // part of the (rotated) photo to keep: { x, y, w, h } as fractions 0..1, or null = whole photo
const CROP_RATIO = 4 / 3; // same shape as the shop's photo frame, so the cropped part fills it completely

// Keep only the cropped part of the photo (full quality).
async function cropBlob(blob, c) {
  const bmp = await bitmapOf(blob);
  const sx = Math.round(c.x * bmp.width), sy = Math.round(c.y * bmp.height);
  const sw = Math.max(1, Math.round(c.w * bmp.width)), sh = Math.max(1, Math.round(c.h * bmp.height));
  const cv = document.createElement("canvas"); cv.width = sw; cv.height = sh;
  cv.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvasToJpeg(cv, 0.95);
}

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

// Where the photo being edited came from:
//   "new"      a photo just taken or picked from the gallery
//   "original" the original photo kept for a gift that is already in the shop
//   "saved"    an older gift with no kept original: only its edited photo exists
let sourceKind = "new";
let srcGen = 0;                       // changes whenever the photo or its rotation changes
let cache = { gen: -1, source: null, studio: null, plain: null };

// For a gift already in the shop with no new photo chosen: open its original (or, for older gifts, its saved photo).
async function ensureSource() {
  if (chosenFile) return true;
  if (!editing || !editing.image) return false;
  try {
    $("photoStatus").textContent = "Opening the photo…";
    const url = editing.original_image || imgSrc(editing);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not open the photo.");
    chosenFile = await res.blob();
    sourceKind = editing.original_image ? "original" : "saved";
    srcGen++;
    return true;
  } catch (err) { $("photoStatus").textContent = friendly(err); return false; }
}

async function rotate(step) {
  if (!(await ensureSource())) return;
  rotation = (rotation + step + 360) % 360;
  crop = null;   // a turned photo has a different shape, so start the crop again
  srcGen++;
  preparePhoto();
}
$("rotLeft").onclick = () => rotate(-90);
$("rotRight").onclick = () => rotate(90);

// ---------- crop ----------
// A 4:3 box over the photo: drag inside to move it, drag a corner to resize it.
let cropBoxPx = null, cropImgUrl = null;           // box in screen pixels while the crop window is open
function defaultCrop(iw, ih) {                     // biggest 4:3 box, in the middle
  let w = iw, h = w / CROP_RATIO;
  if (h > ih) { h = ih; w = h * CROP_RATIO; }
  return { x: (iw - w) / 2, y: (ih - h) / 2, w, h };
}
function drawCropBox() {
  const b = $("cropBox"), c = cropBoxPx;
  b.style.left = c.x + "px"; b.style.top = c.y + "px"; b.style.width = c.w + "px"; b.style.height = c.h + "px";
}
async function openCrop() {
  if (!(await ensureSource())) return;
  $("photoStatus").textContent = "Opening the photo…";
  const full = rotation ? await rotateBlob(chosenFile, rotation) : chosenFile;
  if (cropImgUrl) URL.revokeObjectURL(cropImgUrl);
  cropImgUrl = URL.createObjectURL(full);
  const img = $("cropImg");
  img.onload = () => {
    const iw = img.clientWidth, ih = img.clientHeight;
    cropBoxPx = crop ? { x: crop.x * iw, y: crop.y * ih, w: crop.w * iw, h: crop.h * ih } : defaultCrop(iw, ih);
    drawCropBox();
  };
  img.src = cropImgUrl;
  $("photoStatus").textContent = "";
  $("cropDialog").showModal();
}
$("cropBtn").onclick = openCrop;
$("cropClose").onclick = $("cropCancel").onclick = () => $("cropDialog").close();
$("cropWhole").onclick = () => { crop = null; srcGen++; $("cropDialog").close(); preparePhoto(); };
$("cropApply").onclick = () => {
  const img = $("cropImg"), iw = img.clientWidth, ih = img.clientHeight, c = cropBoxPx;
  crop = { x: c.x / iw, y: c.y / ih, w: c.w / iw, h: c.h / ih };
  srcGen++; $("cropDialog").close(); preparePhoto();
};

(() => {
  const box = $("cropBox"); let drag = null;
  box.addEventListener("pointerdown", e => {
    e.preventDefault(); box.setPointerCapture(e.pointerId);
    const corner = e.target.dataset && e.target.dataset.c;
    drag = { corner, sx: e.clientX, sy: e.clientY, start: { ...cropBoxPx } };
  });
  box.addEventListener("pointermove", e => {
    if (!drag) return;
    const img = $("cropImg"), iw = img.clientWidth, ih = img.clientHeight;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, s = drag.start;
    if (!drag.corner) {                            // move the whole box, keep it on the photo
      cropBoxPx = { ...s, x: Math.min(Math.max(0, s.x + dx), iw - s.w), y: Math.min(Math.max(0, s.y + dy), ih - s.h) };
    } else {                                       // resize from a corner, the opposite corner stays still
      const left = drag.corner.includes("w"), top = drag.corner.includes("n");
      const ax = left ? s.x + s.w : s.x, ay = top ? s.y + s.h : s.y;          // fixed corner
      let w = Math.max(40, (left ? -dx : dx) + s.w);
      w = Math.min(w, left ? ax : iw - ax);                                    // stay inside, left/right
      let h = w / CROP_RATIO;
      const roomY = top ? ay : ih - ay;                                        // stay inside, top/bottom
      if (h > roomY) { h = roomY; w = h * CROP_RATIO; }
      cropBoxPx = { x: left ? ax - w : ax, y: top ? ay - h : ay, w, h };
    }
    drawCropBox();
  });
  const end = () => { drag = null; };
  box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
})();

// The progress circle over the photo: setBusy(42, "text") shows 42%, setBusy(null) hides it.
function setBusy(p, text) {
  const b = $("photoBusy");
  if (p == null) { b.hidden = true; return; }
  b.hidden = false;
  $("busyRing").style.setProperty("--p", p);
  $("busyPct").textContent = p + "%";
  if (text) $("busyText").textContent = text;
}

// Makes the photo that will be SAVED: the edited one ("Edited") or the original one ("Original"),
// following the "Make the photo pretty" switch. Both versions are remembered,
// so switching back and forth is instant after the first time.
async function preparePhoto() {
  if (!chosenFile) return;
  const job = ++photoJob;
  const enhance = $("enhanceToggle").checked;
  const status = m => { if (job === photoJob) $("photoStatus").textContent = m; };
  setSeg(enhance ? "result" : "original");
  $("viewSeg").hidden = false;
  $("saveBtn").disabled = true;
  try {
    if (cache.gen !== srcGen) {
      const gen = srcGen;
      const full = rotation ? await rotateBlob(chosenFile, rotation) : chosenFile;   // upright, whole photo
      const source = crop ? await cropBlob(full, crop) : full;                     // what gets edited
      if (job !== photoJob) return;
      cache = { gen, full, source, studio: null, plain: null };
    }
    const kind = enhance ? "studio" : "plain";
    photo = { original: cache.source, result: cache[kind] };
    if (!cache[kind]) {
      previewBlob(cache.source);
      status(enhance ? "Working on the photo…" : "Preparing the original photo…");
      // Reuse a version that is already being made (for example after switching Edited → Original → Edited).
      const mine = cache;
      const key = kind + "Job";
      if (enhance) setBusy(...(mine.studioPct || [0, "Making the edited photo…"])); else setBusy(null);
      const onPct = (p, t) => { mine.studioPct = [p, t]; if (cache === mine && $("enhanceToggle").checked) setBusy(p, t); };
      mine[key] = mine[key] || (enhance ? studioPhoto(mine.source, status, onPct) : plainPhoto(mine.source))
        .then(r => { mine[kind] = r; return r; })
        .catch(e => { mine[key] = null; throw e; });
      const result = await mine[key];
      if (job !== photoJob) return;
      photo.result = result;
      if (enhance) { setBusy(100, "Done!"); setTimeout(() => { if (job === photoJob) setBusy(null); }, 500); }
    } else setBusy(null);
    previewBlob(photo.result);
    if (enhance) status("✨ Edited photo will be saved. Tap “Original” to save the photo as it is.");
    else if (sourceKind === "saved") status("This gift's original photo wasn't kept (it was added before this option existed). To use the real original, tap “Choose from gallery” and pick it.");
    else status("Original photo will be saved (no background removal).");
  } catch (err) {
    if (job !== photoJob) return;
    console.error(err);
    if (photo) photo.result = null;
    setBusy(null);
    status("Sorry, automatic editing didn't work for this photo: " + friendly(err) + " Tap “Original” to use the photo as it is.");
  } finally {
    if (job === photoJob) $("saveBtn").disabled = false;
  }
}
["photoInput", "cameraInput"].forEach(id => $(id).addEventListener("change", e => {
  const f = e.target.files[0]; e.target.value = "";
  if (f) { chosenFile = f; sourceKind = "new"; rotation = 0; crop = null; srcGen++; $("rotateRow").hidden = false; preparePhoto(); }
}));
async function chooseVersion(enhance) {
  $("enhanceToggle").checked = enhance;
  try { localStorage.setItem(ENHANCE_KEY, enhance ? "1" : "0"); } catch {}
  setSeg(enhance ? "result" : "original");
  if (await ensureSource()) preparePhoto();
}
$("enhanceToggle").addEventListener("change", () => chooseVersion($("enhanceToggle").checked));
function setSeg(v) {
  document.querySelectorAll("#viewSeg button").forEach(b => b.classList.toggle("on", b.dataset.view === v));
}
document.querySelectorAll("#viewSeg button").forEach(b => b.onclick = () => chooseVersion(b.dataset.view === "result"));

// The original photo kept with each gift: upright (after rotation), max 2000px, so it can be re-edited later.
async function originalForStorage(blob) {
  const bmp = await bitmapOf(blob);
  const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  return canvasToJpeg(scaledCanvas(bmp, 0, 0, bmp.width, bmp.height, bmp.width * s, bmp.height * s), 0.9);
}

// ---------- add / edit ----------
function openEditor(g = null) {
  editing = g; photo = null; chosenFile = null; rotation = 0; crop = null; photoJob++; setBusy(null);
  sourceKind = "new"; srcGen++; cache = { gen: -1, source: null, studio: null, plain: null };
  $("rotateRow").hidden = !(g && g.image);
  $("editForm").reset();
  try { $("enhanceToggle").checked = localStorage.getItem(ENHANCE_KEY) !== "0"; } catch {}
  $("editorTitle").textContent = g ? `Edit ${g.name}` : "Add a gift";
  $("saveBtn").textContent = g ? "Save changes" : "Publish";
  $("saveBtn").disabled = false;
  $("editError").textContent = ""; $("photoStatus").textContent = "";
  $("viewSeg").hidden = !(g && g.image); setSeg($("enhanceToggle").checked ? "result" : "original");
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
  let newUrl = null, newOrig = null;
  try {
    if (photo && photo.result) {
      newUrl = data.image = await uploadPhoto(photo.result, name);
      // Keep the original too (upright), unless all we had was an older gift's edited photo.
      if (sourceKind !== "saved" && photo.original && !(sourceKind === "original" && rotation === 0)) {
        // The kept original is the WHOLE photo (upright, not cropped), so it can be cropped differently later.
        newOrig = data.original_image = await uploadPhoto(await originalForStorage(cache.full || photo.original), name + "-original");
      }
    }
    const q = editing ? sb.from("gifts").update(data).eq("id", editing.id) : sb.from("gifts").insert(data);
    const { error } = await q;
    if (error) throw error;
    if (editing && newUrl && editing.image !== newUrl) await deletePhoto(editing.image);
    if (editing && newOrig && editing.original_image && editing.original_image !== newOrig) await deletePhoto(editing.original_image);
    $("editor").close();
    toast(editing ? "Saved! The shop is updated." : `${name} is now in the shop 🦆`);
    loadGifts();
  } catch (ex) {
    if (newUrl) await deletePhoto(newUrl);
    if (newOrig) await deletePhoto(newOrig);
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
    toast(friendly(ex));
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
    const out = await studioPhoto(src, status, (p, t) => status(`${t} ${p}%`));
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

// ---------- requests (confirmed sent on WhatsApp) ----------
let requests = [];
function showTab(which) {
  const req = which === "requests";
  $("requestsView").hidden = !req; $("giftsView").hidden = req;
  $("tabGifts").classList.toggle("on", !req); $("tabRequests").classList.toggle("on", req);
  $("tabGifts").setAttribute("aria-selected", String(!req)); $("tabRequests").setAttribute("aria-selected", String(req));
  if (req) loadRequests();
}
$("tabGifts").onclick = () => showTab("gifts");
$("tabRequests").onclick = () => showTab("requests");
$("reqFilter").addEventListener("change", renderRequests);
$("reqRefresh").onclick = () => loadRequests();

async function loadRequests() {
  const { data, error } = await sb.from("requests").select("*").order("created_at", { ascending: false }).limit(300);
  if (error) { toast(friendly(error)); return; }
  requests = data;
  renderRequests();
}
function updateNewBadge() {
  const n = requests.filter(r => r.status === "new").length;
  $("newCount").textContent = n; $("newCount").hidden = !n;
}
async function refreshNewBadge() {
  const { count } = await sb.from("requests").select("id", { count: "exact", head: true }).eq("status", "new");
  $("newCount").textContent = count || 0; $("newCount").hidden = !count;
}

function renderRequests() {
  updateNewBadge();
  const f = $("reqFilter").value;
  const list = requests.filter(r => f === "all" || r.status === f);
  const box = $("reqList"); box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = `<p class="muted">${f === "new" ? "No new requests. When a girl taps “Open WhatsApp” in the shop, her request appears here." : "Nothing here yet."}</p>`;
    return;
  }
  const when = d => new Date(d).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  list.forEach(r => {
    // A request still "New" after 3 days was probably never sent on WhatsApp.
    const stale = r.status === "new" && Date.now() - new Date(r.created_at) > 3 * 24 * 3600 * 1000;
    const el = document.createElement("article"); el.className = "req is-" + r.status + (stale ? " is-stale" : "");
    const head = document.createElement("div"); head.className = "req-head";
    const who = document.createElement("b"); who.textContent = r.name;
    const refEl = document.createElement("span"); refEl.className = "ref"; refEl.textContent = r.ref;
    refEl.title = "Search this order number in WhatsApp to find her message";
    const meta = document.createElement("small"); meta.textContent = when(r.created_at);
    const pill = document.createElement("span"); pill.className = "pill " + (stale ? "stale" : r.status);
    pill.textContent = stale ? "Probably not sent?" : { new: "New", done: "Done", cancelled: "Cancelled" }[r.status];
    head.append(who, refEl, meta, pill);
    const ul = document.createElement("ul");
    (r.items || []).forEach(it => { const li = document.createElement("li"); li.textContent = `${it.name} × ${it.qty} = ${it.qty * it.points} Ducks`; ul.appendChild(li); });
    const tot = document.createElement("div"); tot.className = "req-total"; tot.textContent = `${r.total_gifts} gift${r.total_gifts === 1 ? "" : "s"} · ${r.total_points} Ducks`;
    const act = document.createElement("div"); act.className = "req-actions";
    if (r.status === "new") {
      act.append(btn("✅ Done (lower stock)", "primary", () => reqAction(r, "done")), btn("Cancel", "ghost", () => reqAction(r, "cancel")));
    } else {
      act.append(btn(r.status === "done" ? "↩ Undo (put stock back)" : "↩ Make it new again", "ghost", () => reqAction(r, "reopen")));
      if (r.status === "cancelled") act.append(btn("🗑 Delete", "danger", () => reqAction(r, "delete")));
    }
    el.append(head, ul, tot, act);
    box.appendChild(el);
  });
}

async function reqAction(r, what) {
  let error;
  if (what === "done") ({ error } = await sb.rpc("complete_request", { p_id: r.id }));
  else if (what === "reopen") ({ error } = await sb.rpc("reopen_request", { p_id: r.id }));
  else if (what === "delete") {
    if (!confirm(`Delete ${r.name}'s cancelled request ${r.ref}? This cannot be undone.`)) return;
    ({ error } = await sb.from("requests").delete().eq("id", r.id));
  }
  else ({ error } = await sb.from("requests").update({ status: "cancelled" }).eq("id", r.id));
  if (error) { toast(friendly(error)); return; }
  toast({ done: `Done! Stock lowered for ${r.name}'s gifts.`, reopen: "Moved back to New.", delete: "Request deleted." }[what] || "Request cancelled (stock not changed).");
  await Promise.all([loadRequests(), loadGifts()]);
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
// Ask the browser to keep the saved photo tool, so it is not cleared and downloaded again.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT") show("loginView"); });
start().catch(err => { show("loginView"); $("loginError").textContent = friendly(err); });
