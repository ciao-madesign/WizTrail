// ===============================
//  WizTrail PWA – Service Worker
//  Version bump: CHANGE THIS to force update
// ===============================
const CACHE_VERSION = "wiztrail-v2026-04-21a";
const CORE_CACHE = [
  "/",
  "/landing.html",
  "/index.html",
  "/about.html",
  "/wiztrail.css",
  "/wiztrail-engine.js",
  "/wiztrail-pacing.js",
  "/wiztrail-report.js",
  "/wiztrail-postgara.js",
  "/gpx-parser.js",
  "/discipline-classifier.js",
  "/map.js",
  "/ui.js",
  "/main.js",
  "/manifest.webmanifest",
  "/img/logo.svg",
  "/img/hero-index.jpg"
];

// Pagine statiche extra da mettere in cache
const PAGE_CACHE = [
  "/ranking.html",
  "/dettaglio.html",
  "/install.html",
  "/training-analyzer.html",
  "/share_card.html",
  // wdi.html e pacing.html rimossi: contenuto migrato in about.html
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
// FETCH — network first per HTML, CSS, JS · cache first per immagini
// ===============================
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = req.url;

  // Immagini → cache first (cambiano raramente)
  if (req.destination === "image") {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (!res || !res.ok) return res;
          const resClone = res.clone(); // clona prima di consumare
          caches.open(CACHE_VERSION).then(c => c.put(req, resClone));
          return res;
        });
      })
    );
    return;
  }

  // HTML, CSS, JS → network first, fallback cache
  // Garantisce che dopo un deploy gli utenti vedano subito la versione aggiornata
  if (
    req.headers.get("accept")?.includes("text/html") ||
    url.includes(".css") ||
    url.includes(".js")
  ) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (!res || !res.ok) return res;
          // Clona PRIMA di consumare — evita "body already used"
          if (!url.includes("html2canvas")) {
            const resClone = res.clone();
            caches.open(CACHE_VERSION).then(c => c.put(req, resClone));
          }
          return res;
        })
        .catch(() => caches.match(req)) // offline fallback
    );
    return;
  }

  // Tutto il resto → cache first
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req))
  );
});
