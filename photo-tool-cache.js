// Keeps the photo-editing tool (about 40 MB) on this device after the first download,
// so the admin page doesn't download it again every time.
// It only stores the tool files. It never stores gifts, photos or anything private.
const CACHE = "duck-photo-tool-v1";
const TOOL_HOSTS = ["staticimgly.com", "cdn.jsdelivr.net"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || !TOOL_HOSTS.includes(url.hostname)) return;
  // Only the background-removal tool and the supabase library (exact versions, never change).
  if (!/@imgly\/background-removal|onnxruntime|@supabase\/supabase-js@2\.118\.0/.test(url.pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request.url);
    if (hit) return hit;
    const res = await fetch(e.request);
    if (res.ok) cache.put(e.request.url, res.clone()).catch(() => {});
    return res;
  })());
});
