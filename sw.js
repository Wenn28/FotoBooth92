// Service worker: menyimpan salinan aplikasi agar booth tetap terbuka saat venue tanpa internet.
// Strategi: ambil dari jaringan dulu (supaya update langsung terpakai), pakai salinan bila offline.
const CACHE = "booth-v7";
const NET_TIMEOUT_MS = 4000; // wifi venue yang lambat dianggap offline setelah 4 detik
const SHELL = [
  "./", "index.html", "galeri.html", "style.css", "templates.json", "filters.json", "manifest.webmanifest",
  "js/booth.js", "js/render.js", "js/cloud.js", "js/config.js", "js/frames.js",
];
// Hanya file aplikasi, font, dan pustaka yang di-cache; Firestore dan upload tidak
const CACHE_HOSTS = [self.location.host, "www.gstatic.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || !CACHE_HOSTS.includes(url.host)) return;
  if (url.host === "www.gstatic.com" && !url.pathname.startsWith("/firebasejs/")) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([
        fetch(e.request),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NET_TIMEOUT_MS)),
      ]);
      if (res.ok || res.type === "opaque") cache.put(e.request, res.clone());
      return res;
    } catch {
      const hit = await cache.match(e.request, { ignoreSearch: url.host === self.location.host && url.pathname.endsWith(".html") });
      if (hit) return hit;
      throw new Error("Offline dan belum ada salinan");
    }
  })());
});
