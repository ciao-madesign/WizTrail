// ===============================
//  WizTrail PWA – Service Worker
//  Version bump: CHANGE THIS to force update
// ===============================
const CACHE_VERSION = "wiztrail-v2026-06-10i";
const CORE_CACHE = [
  "/",
  "/landing.html",
  "/index.html",
  "/about.html",
  "/wiztrail.css",
  "/wiztrail-engine.js",
  "/wiztrail-pacing.js",
  "/wiztrail-timing.js",
  "/gpx-parser.js",
  "/discipline-classifier.js",
  "/map.js",
  "/ui.js",
  "/main.js",
  "/cookie-notice.js",
  "/trail-stats.js",
  "/trail-insights.js",
  "/trail-card.html",
  "/manifest.webmanifest",
  "/img/logo.svg",
  "/img/hero-index.jpg",
  "/img/hero-calc.jpg",
  "/img/hero-ranking.jpg",
  "/fonts/fonts.css",
  "/lib/leaflet/leaflet.css",
  "/lib/leaflet/leaflet.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable.svg"
];

// Pagine statiche extra da mettere in cache
const PAGE_CACHE = [
  "/ranking.html",
  "/dettaglio.html",
  "/install.html",
  "/training-analyzer.html",
  "/share_card.html",
  "/privacy.html",
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
// WEB SHARE TARGET — intercetta POST da app mobile
// ===============================
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method === "POST" && url.pathname === "/index.html") {
    event.respondWith((async () => {
      try {
        const formData = await req.formData();
        const file = formData.get("gpx");
        if (file && file.size > 0) {
          const buf = await file.arrayBuffer();
          const shareCache = await caches.open("wiztrail-share-queue");
          await shareCache.put("/shared-gpx", new Response(buf, {
            headers: {
              "Content-Type": file.type || "application/gpx+xml",
              "X-Filename":   file.name  || "shared.gpx",
            }
          }));
        }
      } catch (e) {
        console.error("share target error:", e);
      }
      return Response.redirect("/index.html?shared=1", 303);
    })());
    return;
  }
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
          const resClone = res.clone();
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
