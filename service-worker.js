// ===============================
//  WizTrail PWA – Service Worker
//  Version bump: CHANGE THIS to force update
// ===============================
const CACHE_VERSION = "wiztrail-v2026-04-15b";
const CORE_CACHE = [
  "/WizTrail/",
  "/WizTrail/index.html",
  "/WizTrail/wiztrail.css",
  "/WizTrail/wiztrail-engine.js",
  "/WizTrail/wiztrail-pacing.js",
  "/WizTrail/wiztrail-report.js",
  "/WizTrail/wiztrail-postgara.js",
  "/WizTrail/gpx-parser.js",
  "/WizTrail/discipline-classifier.js",
  "/WizTrail/map.js",
  "/WizTrail/ui.js",
  "/WizTrail/main.js",
  "/WizTrail/manifest.webmanifest",
  "/WizTrail/img/logo.svg"
];

// Pagine statiche extra da mettere in cache
const PAGE_CACHE = [
  "/WizTrail/wdi.html",
  "/WizTrail/pacing.html",
  "/WizTrail/ranking.html",
  "/WizTrail/dettaglio.html",
  "/WizTrail/install.html",
  "/WizTrail/training-analyzer.html",
  "/WizTrail/share_card.html",
];

// Unione liste
const URLS_TO_CACHE = [...CORE_CACHE, ...PAGE_CACHE];


// ===============================
// INSTALL — pre-cache
// ===============================
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
  self.skipWaiting(); // forza subito nuova versione
});


// ===============================
// ACTIVATE — elimina vecchie cache
// ===============================
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});


// ===============================
// FETCH — network first per HTML, cache first per asset
// ===============================
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // HTML → rete prima, fallback cache
  if (req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // Per JS/CSS/img → cache first
  event.respondWith(
    caches.match(req).then((cacheRes) => {
      return (
        cacheRes ||
        fetch(req).then((netRes) => {
          // Evitiamo di cachet html2canvas (lib online)
          if (!req.url.includes("html2canvas")) {
            caches.open(CACHE_VERSION).then((cache) => {
              cache.put(req, netRes.clone());
            });
          }
          return netRes;
        })
      );
    })
  );
});
