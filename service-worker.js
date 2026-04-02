// ===============================
// WizTrail PWA – Service Worker (FIXED 2026)
// ===============================

const CACHE_VERSION = "wiztrail-v2026-04-fixed";

const CORE_CACHE = [
  "/WizTrail/",
  "/WizTrail/index.html",
  "/WizTrail/wiztrail.css",
  "/WizTrail/wiztrail-wdit.js",
  "/WizTrail/wiztrail-pacing.js",
  "/WizTrail/wiztrail-report.js",
  "/WizTrail/wiztrail-postgara.js",
  "/WizTrail/manifest.webmanifest",
  "/WizTrail/img/logo.svg"
];

const PAGE_CACHE = [
  "/WizTrail/wdi.html",
  "/WizTrail/pacing.html",
  "/WizTrail/ranking.html",
  "/WizTrail/dettaglio.html",
  "/WizTrail/install.html",
  "/WizTrail/training-analyzer.html",
  "/WizTrail/share_card.html"
];

const URLS_TO_CACHE = [...CORE_CACHE, ...PAGE_CACHE];

// ===============================
// INSTALL
// ===============================
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(URLS_TO_CACHE))
  );
  self.skipWaiting();
});

// ===============================
// ACTIVATE
// ===============================
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ===============================
// FETCH — FIXATO (nessun clone doppio)
// ===============================

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // HTML = network first
  if (req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // STATIC ASSETS = cache first + safe update
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        // aggiorna in background evitando doppio consumo
        fetch(req).then(netRes => {
          if (netRes && netRes.ok && !req.url.includes("html2canvas")) {
            const clone = netRes.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(req, clone));
          }
        }).catch(() => {}); // silenzioso
        return cached;
      }

      // no cache → rete
      return fetch(req)
        .then(netRes => {
          if (netRes && netRes.ok && !req.url.includes("html2canvas")) {
            const clone = netRes.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(req, clone));
          }
          return netRes;
        })
        .catch(() => new Response("Offline", { status: 503 }));
    })
  );
});