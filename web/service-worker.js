// Network-first so app updates deploy cleanly (offline support is best-effort).
const CACHE_NAME = "produce-inventory-pwa-v7";
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js?v=2026.03.07.6",
  "./config.js?v=2026.03.07.6",
  "./supabaseClient.js?v=2026.03.07.6",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/fst-logo.png",
  "./icons/fst-app-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isNav = event.request.mode === "navigate";
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return resp;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || (isNav ? caches.match("./index.html") : null))
      )
  );
});
