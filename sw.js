/* Offline cache: the app shell plus the js-dos emulator files from its CDN.
 * Game data never goes through here; it lives in IndexedDB. */
const VERSION = "orionpad-v4";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "manifest.webmanifest",
  "icons/icon-167.png",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];
const CDN_HOST = "v8.js-dos.com";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Emulator files: cache-first, refreshed in the background.
  if (url.host === CDN_HOST) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        const net = fetch(req)
          .then((res) => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; })
          .catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // App shell: network-first so updates arrive, cache when offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("index.html")))
    );
  }
});
