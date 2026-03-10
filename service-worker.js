const CACHE_NAME = "wiztrail-cache-v1";

const ASSETS = [
  "/WizTrail/",
  "/WizTrail/index.html",
  "/WizTrail/style.css",
  "/WizTrail/script.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});