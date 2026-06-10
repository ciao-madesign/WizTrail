# CLAUDE.md — WizTrail: Guida per agenti Claude

Questo documento è scritto per un agente Claude che arriva sul progetto senza contesto. Leggi tutto prima di toccare il codice.

---

## Cos'è WizTrail

WizTrail è una **piattaforma web per l'analisi tecnica dei percorsi trail running**. Calcola la difficoltà di un percorso (indice WDI) da un file GPX o da input manuali, stima i tempi di gara, e fornisce statistiche dettagliate sul percorso. È una PWA (Progressive Web App) con service worker, offline support e installabilità mobile.

**URL di produzione:** https://wiz-trail.vercel.app  
**Repository:** ciao-madesign/WizTrail  
**Branch principale (= produzione su Vercel):** `backend`  
**Owner:** michele.aldeni1995@gmail.com

---

## Stack tecnico

| Layer | Tecnologia |
|---|---|
| Frontend | HTML/CSS/JS puro — **nessun framework, nessun bundler** |
| Backend / API | Vercel Serverless Functions (Node.js ES modules) |
| Database | Upstash Redis (REST API) |
| Mappa | Leaflet.js self-hosted |
| Deploy | Vercel — branch `backend` = produzione automatica |
| CI | GitHub Actions (solo per pipeline di calibrazione) |

**Vincolo critico:** Il piano Vercel Hobby permette **max 12 serverless functions**. Al momento sono 11/12 usate. Non aggiungere nuovi file in `/api/` senza consolidare in `api/hub.js` (pattern già usato) o upgradare il piano.

---

## Architettura frontend

### Pattern dei moduli JS

Tutti i file JS del frontend usano il pattern **IIFE** (Immediately Invoked Function Expression) e espongono un singolo oggetto globale su `window`:

```js
window.NomeModulo = (function () {
  'use strict';
  // ... codice privato ...
  return { functionePubblica };
})();
```

**Non usare ES modules (`import/export`) nel frontend** — non c'è bundler.

### Globali di stato (main.js)

`main.js` espone queste variabili globali che i moduli si aspettano di trovare su `window`:

| Variabile | Tipo | Chi la scrive | Chi la legge |
|---|---|---|---|
| `window.gpxPts` | `[[lat,lon,ele],...]` | main.js | map.js, wiztrail-pacing.js |
| `window.metrics` | `{km, gain, e[], d[], max_altitude}` | main.js | map.js, ui.js |
| `window.currentWDI` | number | main.js | map.js (colore traccia) |
| `window.lastRS` | oggetto risultato engine | main.js | export JSON, feedback |
| `window._gpxFileName` | string | main.js | trail-card.html (via sessionStorage) |
| `window._wizMap` | Leaflet map | map.js | wiztrail-pacing.js |
| `window._wizHoverMarker` | Leaflet marker | map.js | wiztrail-pacing.js |

**Note su globali dead code (non rimuovere senza capire):**
- `window.currentWDI_norm` — impostata ma mai letta; era prevista per display futuro
- `window.lastOsmResult` — sempre `null`; la feature OSM Enhanced è stata rimossa (wiztrail-osm.js non esiste più)

### Ordine di caricamento script in index.html

```
Leaflet → wiztrail-engine.js → wiztrail-pacing.js → wiztrail-timing.js
       → gpx-parser.js → trail-stats.js → discipline-classifier.js
       → map.js → ui.js → main.js → cookie-notice.js (defer)
```

`trail-stats.js` deve essere caricato DOPO `gpx-parser.js` (dipende da `GPXParser`).

### Versioning degli script

I file JS in index.html usano query string per cache busting:
```html
<script src="gpx-parser.js?v=20260415"></script>
```
Quando modifichi un file JS caricato in index.html, **aggiorna il timestamp** `?v=YYYYMMDD`. Stesso vale per service-worker.js: aggiorna `CACHE_VERSION`.

---

## Il motore WDI (wiztrail-engine.js)

### Formula

```
WDI = (VolumeScore + TechScore × kT) × DistFactor × AltFactor

kT = 0.50  (calibrato 20/04/2026, era 0.35)
```

**VolumeScore** = `f(D+ + D-)` — volume altimetrico puro  
**TechScore** = 0-100 assoluto — tecnicità del terreno (FRIP, SlopeVar, Roughness, intensità verticale)  
**DistFactor** = scala logaritmica per km (formula diversa sopra 100km)  
**AltFactor** = bonus alta quota (> 1300m s.l.m., max +15%)

### WDI normalizzato (WDI_norm)

Il WDI grezzo non è confrontabile tra distanze diverse. `WDI_norm` porta tutto su scala 0-10 per categoria, con curva power sub-lineare (v5, 10/06/2026):

```
norm = x^0.65 × 10,  dove x = clamp((WDI − wdiMin) / (wdiMax − wdiMin), 0, 1)
```

`NORM_GAMMA = 0.65` solleva i valori bassi (~+150% a x=0.10) lasciando quasi invariati i medi-alti (~+6% a x=0.85).

| Categoria | km | WDI grezzo 0-10 |
|---|---|---|
| Short | ≤ 25 | 10 → 80 |
| Medium | 26-50 | 15 → 100 |
| Long | 51-95 | 30 → 160 |
| Ultra | > 95 | 80 → 300 (Legend∞ oltre 300) |

**Regola:** Usa sempre `WDI` grezzo per calcoli interni (pacing, classificazione, comparazione tra gare). Usa `WDI_norm` solo per display all'utente.

**ATTENZIONE — WDI non è sinonimo di tecnicità del terreno.** WDI include VolumeScore (dislivello) e DistFactor (distanza) oltre a TechScore. Se hai bisogno di un proxy per la sola difficoltà tecnica del terreno (irregolarità, rocce, esposizione), usa `TechScore` (0-100, già in `rs.TechScore`). Confonderli causa double-counting nel modello di timing. Vedi sezione "Pacing e timing" per dettagli.

### Classi WDI (v3, calibrate su 95 gare, 05/05/2026)

```
Sport < 22 | Pro < 40 | Advanced < 70 | Extreme < 120 | Elite < 200 | Legend ∞
```

### TechScore — componenti

```
TechScore = f(FRIP, SlopeVar, Roughness, gain/km, surfaceLevel)
```

- **FRIP** (Fractional Irregularity Profile) — variazione di pendenza a corto raggio
- **SlopeVar** — varianza delle pendenze sull'intero percorso
- **Roughness** — "ruvidità" del profilo di pendenza
- `normRough = 0.500` (recalibrato 28/04/2026, era 0.051 — saturava su GPX reali)

### API pubblica di wiztrail-engine.js

```js
WizTrail.computeFromGpx(pts, metrics, surfaceLevel, osmResult)
// → { WDI, WDI_norm, WDI_category, WDI_legendPlus, class, color,
//     TechScore, techClass, techColor,
//     factors: { km, gain, loss, VolumeScore, DistFactor, AltFactor,
//                FRIP, SlopeVar, Roughness, surfaceLevel, osmScore, osmConfidence },
//     estimatedTech, isVK }

WizTrail.computeManual({ km, gain, loss, terrainCat, surfaceLevel, altMedia })
// → stessa struttura ma senza GPX reale; usa TERRAIN_DEFAULTS per FRIP/SlopeVar/Roughness

WizTrail.normalizeWDI(wdi, km)   // → { norm, category, isLegendPlus }
WizTrail.getColor(wdi)           // → hex color string
WizTrail.getClass(wdi)           // → 'Sport'|'Pro'|...|'Legend'
```

**ATTENZIONE — Drift Engine:** `api/lib/engine-node.js` è un PORT SERVER-SIDE di `wiztrail-engine.js`. **Ogni modifica a kT, soglie WDI, o formule nel frontend deve essere replicata in `api/lib/engine-node.js`**, altrimenti i calcoli frontend e API divergono. Stesso vale per `api/lib/pacing-node.js` rispetto a `wiztrail-pacing.js`.

---

## GPX Parser (gpx-parser.js)

### API pubblica

```js
GPXParser.parseTrack(xmlDoc)       // → [[lat,lon,ele], ...]
GPXParser.parseTrackFull(xmlDoc)   // → { pts, times }
GPXParser.compute(pts)             // → { km, gain, e[], eSmooth[], d[], max_altitude, elevQuality }
GPXParser.computeSegments(pts, dist, elev, segLength=80)
                                   // → [{ dist, dh, slope, idxStart, idxEnd }]
GPXParser.hav(lat1, lon1, lat2, lon2)  // → distanza in METRI (haversine)
GPXParser.smoothElevation(elev, windowSize)
GPXParser.clampSlope(dh, dd, maxSlope=0.35)
```

### Note importanti su GPXParser.compute()

- Restituisce `e[]` (quote raw, per display profilo e statistiche altimetriche) e `d[]` (distanze cumulative in METRI)
- Restituisce `eSmooth[]` (media mobile adattiva 3/5/9 punti) — usata dal motore per FRIP/SlopeVar/Roughness al posto di `e[]` raw
- Restituisce `elevQuality`: `'clean'` (barometrico/buono) | `'dem'` (DEM-corretta, tecnicità sottostimata) | `'noisy'` (GPS rumoroso)
- **Non restituisce D-** (loss): calcolato internamente nell'engine, disponibile in `engineResult.factors.loss`
- **Non restituisce altitudine minima o media**: calcolate in trail-stats.js
- Smoothing adattivo: window 3/5/9 punti in base alla densità della traccia
- D+ con isteresi per tracce piatte (elevRange < 30m) per evitare falsi positivi GPS
- Douglas-Peucker decimazione a max 5000 punti

---

## Moduli di analisi aggiuntivi

### trail-stats.js (aggiunto PR #69, 09/06/2026)

Calcola statistiche dettagliate. **Riusa i dati dall'engine senza ricalcolare.**

```js
TrailStats.compute(pts, metrics, engineResult)
// → {
//   alt_min, alt_mean, alt_max, alt_start, alt_end,
//   gain, loss,                          // da GPXParser e engine
//   slope_up_avg, slope_up_max,          // % (media pesata per distanza)
//   slope_down_avg, slope_down_max,      // % assoluto
//   pct_uphill, pct_flat, pct_downhill,  // % distanza (soglia 2%)
//   climbs_count, descents_count,        // salite/discese significative
//   longest_climb_km, longest_climb_gain,
//   trail_efficiency,                    // 0-1 (retta A→B / km totali)
//   roughness, slope_var, frip,          // passthrough da engine
//   tech_density                         // TechScore/km
// }
```

Soglie salite significative (adattive): `< 50km` → 300m orizzontali + 30m D+; `≥ 50km` → 500m + 50m.

### trail-insights.js (aggiunto PR #69, 09/06/2026)

```js
TrailInsights.generate(stats, engineResult)
// → { race: [string × 5], training: [string × 5] }
```

Genera insight testuali variabili. Sistema: tier (0/1/2 per intensità parametro) + `pick()` randomica tra 2-3 varianti per tier. **Ogni chiamata produce una composizione diversa.** I parametri guidano la selezione del tier; la randomizzazione garantisce variabilità apparente.

---

## Mappa e profilo altimetrico (map.js)

```js
WizMap.init()         // inizializza Leaflet su #pacingMap
WizMap.drawTrack()    // disegna polyline colorata per WDI su window.gpxPts
WizMap.drawProfile()  // disegna grafico altimetrico su #elevCanvas
WizMap.fitTrack()     // centra mappa sulla traccia
WizMap.clearTrack()   // rimuove polyline (usato da wiztrail-pacing prima di layer pacing)
WizMap.getColorWDI(wdi) // → hex color per valore WDI
```

**`drawProfile()` legge dai globali `window.metrics` e `window.gpxPts`** — devono essere impostati prima della chiamata. Il profilo è Canvas interattivo con tooltip hover e sincronizzazione mappa.

**Riuso in trail-card.html:** La pagina imposta stub di `window.gpxPts` (array della lunghezza corretta con `[0,0,0]`) per passare il guard di lunghezza. La sincronizzazione mappa non funziona (nessuna mappa in trail-card) ma fallisce silenziosamente (null check su `_wizMap`).

---

## Trail Identity Card (trail-card.html)

### Flusso dati

```
index.html (calcolo GPX)
  → main.js salva in sessionStorage('wiztrail_trail_card')
    { trackName, from, stats, engine, metricsChart: {e[], d[], km} }
  → trail-card.html legge da sessionStorage
  → Ripristina window.metrics e window.gpxPts stub
  → Chiama WizMap.drawProfile()
  → Chiama TrailInsights.generate() per insights freschi
```

### Dati NON memorizzati in sessionStorage

I `pts` originali (fino a 5000 `[lat,lon,ele]`) non vengono salvati per limitare la dimensione del payload. Solo `metricsChart.e[]` e `metricsChart.d[]` vengono salvati (sufficienti per il profilo altimetrico).

### Bottone "Scheda dettagliata"

Appare in `index.html` solo dopo calcolo con GPX reale (non in modalità noGpx). Elemento: `<a id="trailCardBtn">`, mostrato in `main.js` con `style.display = 'flex'`.

---

## API Backend (Vercel Serverless)

### Struttura

```
api/
├── hub.js              — handler multi-azione (auth, upload, activities, run, patch, feedback)
├── import/url.js       — proxy fetch GPX da URL esterno (anti-SSRF)
├── strava/callback.js  — OAuth2 callback Strava
├── strava/activities.js — lista attività
├── strava/activity.js  — singola attività con parsing GPX
├── v1/wdi.js           — API pubblica WDI da input manuali (richiede x-api-key)
├── v1/analyze.js       — API pubblica analisi GPX completa (richiede x-api-key)
└── lib/
    ├── engine-node.js  — PORT server-side di wiztrail-engine.js (mantenere sincronizzato!)
    ├── gpx-node.js     — PORT server-side di gpx-parser.js
    ├── pacing-node.js  — PORT server-side di wiztrail-pacing.js
    ├── timing-node.js  — PORT server-side di wiztrail-timing.js
    └── ratelimit.js    — rate limiting su Redis (namespace wiztrail:rl:)
```

### Variabili d'ambiente richieste

```
UPSTASH_REDIS_REST_URL     — URL Upstash Redis
UPSTASH_REDIS_REST_TOKEN   — token Upstash
HUB_SECRET_TOKEN           — token per ricezione risultati calibrazione
HUB_ADMIN_TOKEN            — token admin dashboard
GITHUB_TOKEN               — per trigger GitHub Actions (calibrazione)
GITHUB_REPO                — "ciao-madesign/WizTrail"
API_KEYS                   — chiavi API pubbliche (comma-separated)
STRAVA_CLIENT_ID           — OAuth Strava
STRAVA_CLIENT_SECRET       — OAuth Strava
```

### Redis namespace

Tutte le chiavi Redis usano il prefisso `wiztrail:` per isolare da altri progetti:
- `wiztrail:rl:<ip>` — rate limiting
- `wiztrail:activities:<id>` — attività caricate
- `wiztrail:ranking` — dati ranking
- `wiztrail:feedback:<ts>` — feedback post-gara

### Sicurezza API

- **SSRF**: `api/import/url.js` blocca esplicitamente IP privati (127.x, 10.x, 192.168.x, 172.16-31.x, 169.254.x — incluso AWS metadata endpoint), IPv6 locali, schemi non-http/https
- **CSRF**: `api/hub.js` → `handleFeedback()` usa `setFeedbackCors(res, origin)` con allowlist esplicita: `['https://wiz-trail.vercel.app', 'https://ciao-madesign.github.io']` + wildcard `*.vercel.app`
- **Rate limiting**: Redis sliding window, implementato in `api/lib/ratelimit.js`

---

## Service Worker (service-worker.js)

- **CACHE_VERSION** — bump questo valore per forzare aggiornamento cache su tutti i client. Formato: `wiztrail-v{YYYY-MM-DD}{lettera}` (es. `wiztrail-v2026-06-09a`)
- Strategia: **network-first** per HTML/CSS/JS (aggiornamenti immediati post-deploy), **cache-first** per immagini
- I nuovi file statici vanno aggiunti a `CORE_CACHE` o `PAGE_CACHE`
- `PAGE_CACHE` include pagine secondarie; `CORE_CACHE` include dipendenze critiche per offline

**Attuale CACHE_VERSION:** `wiztrail-v2026-06-10k`

---

## Pacing e timing

### wiztrail-pacing.js

Calcola i tempi di gara per segmento. La funzione principale viene chiamata da `main.js` dopo il calcolo WDI. Richiede `window.gpxPts`, `window.metrics`, il risultato engine.

**Bug noto pre-esistente:** Il codice cerca `#pacingElevCanvas` che non esiste nel DOM — le funzioni relative falliscono silenziosamente (null check).

### wiztrail-timing.js

Modello di pacing su segmenti v2.0. Calcola il tempo stimato T dal passo base (da T10k) applicando fattori di terreno, pendenza, tecnicità. Espone `WizTrailTiming`.

**Fase 12 — Athlete Profile (10/06/2026):** aggiunto `KF_TERRAIN_PARAMS` e `terrainFactor(techScore, S)`.

```
T_finale = T_segmenti × KF_terrain
KF_terrain = 1 + (TechScore / tech_scale) × (1 - S × specificity_weight)
```

Parametri iniziali: `tech_scale=400`, `specificity_weight=0.4`.
Calibrabili via `PATCH /api/hub?action=patch` con `{ timing: { kf_terrain: { tech_scale: X, specificity_weight: Y } } }`.

**IMPORTANTE — perché TechScore e non WDI:**
WDI = `(VolumeScore + TechScore×kT) × DistFactor × AltFactor` — contiene distanza e dislivello
già modellati dal timing engine (pendenze, fatica). Usare WDI come fattore causerebbe
double-counting e gonfia la penalità sulle ultra proporzionalmente alla loro lunghezza
(LUT120 WDI=178 → +31%, CDF 12K WDI=32 → +6% — paradossale).
TechScore è `f(FRIP, SlopeVar, Roughness, surfaceLevel)` — l'unico componente genuinamente
assente dal modello a segmenti. Con TechScore le correzioni sono coerenti (11-18%)
indipendentemente dalla distanza: LUT120 TS=65 → +14%, Comapedrosa TS=80 → +18%.

**Non usare mai WDI come proxy di tecnicità del terreno nel modello di timing.**

---

## Strava integration

- OAuth2 flow: `auth_strava.html` → `api/strava/callback.js` → redirect a index con token
- Token salvato in `sessionStorage` (non localStorage — scade alla chiusura tab)
- L'endpoint Strava usa `www.strava.com/api/v3` (non `www.api-v3.strava.com` — al 09/06/2026 il nuovo dominio risponde ECONNREFUSED, non migrare)
- **URGENTE:** Developer subscription Strava scade entro giugno 2026 (~$11.99/mese su developers.strava.com)

---

## Modalità noGpx (calcolo manuale)

L'utente può calcolare WDI senza GPX inserendo km + D+ manualmente. In questo caso:
- `window.gpxPts` rimane `[]`
- `noGpx = true` in main.js → salta mappa, profilo altimetrico, discipline badge, trail-card
- Usa `WizTrail.computeManual()` con TERRAIN_DEFAULTS invece di dati GPX reali
- L'output ha `estimatedTech: true` e un warning visivo

---

## Disciplina automatica (discipline-classifier.js)

Classifica automaticamente il tipo di gara in base a km, D+, max_altitude, WDI:
- Trail corto, Trail, Ultra Trail, Skyrace, VK (Vertical Km)
- VK = km < 15 && D+/km > 80 (calcolato anche nell'engine)

---

## Ranking e Dettaglio gara

- `ranking.html` — lista gare caricate sul backend Redis, filtrabili
- `dettaglio.html` — scheda singola gara con WDI, tempi, classifiche
- I dati ranking vengono da `api/hub.js?action=activities`

---

## CSS

`wiztrail.css` è il **file CSS unico** per tutta l'app. Non esiste CSS separato per pagina.

### Variabili CSS (tema dark/light)

```css
--bg, --card, --ink, --muted, --accent (#4fd1c5 dark / #0ea5e9 light)
--warn (#ffb020), --error (#ff6b6b), --border, --panel
--font-sans: 'Outfit', --font-mono: 'DM Mono'
```

### Classi principali riutilizzabili

```css
.wrap          — container centrato, max-width, padding
.card          — contenitore card con sfondo, bordo, border-radius
.grid.grid-2   — griglia 2 colonne responsive (1 colonna < 600px)
.btn           — bottone primario
.btn.secondary — bottone secondario
.kpi           — blocco KPI con label + valore grande
.profile-wrap  — container canvas profilo altimetrico
.btn-trail-card — bottone "Scheda dettagliata"
.tc-*          — classi trail-card (sezioni, righe, bar, insights)
```

---

## Calibrazione e dati storici

### Storia calibrazioni motore

| Data | Cosa | Valore prima | Valore dopo |
|---|---|---|---|
| 20/04/2026 | kT | 0.35 | 0.50 |
| 28/04/2026 | normRough | 0.051 | 0.500 (saturava su GPX reali) |
| 28/04/2026 | TERRAIN_DEFAULTS | v1 | v2 (per contesto gara) |
| 11/05/2026 | WDI_NORM_CATEGORIES | v2 | v3 (calibrate su 31 gare) |
| 05/05/2026 | WDI_THRESHOLDS | v2 | v3 (calibrate su 95 gare) |
| 10/06/2026 | TERRAIN_DEFAULTS | v2 | v3: fix saturazione normSVar — tutti i valori slopeVar (0.38/0.55/0.70) saturavano a 1.0 dopo il cambio ref normSVar 0.55→0.180 (non documentato). Nuovi valori: E{frip:0.25,sV:0.08,rough:0.10}, EE{0.48,0.13,0.20}, EA{0.72,0.17,0.32} |
| 10/06/2026 | WDI_NORM_CATEGORIES | v3 | v4: massimi v3 irraggiungibili in pratica (Short max=65, realistico ~50; Long max=175, realistico ~130). Tutto si comprimeva verso 0 (trail 12km competitivo → 0.6/10). Nuove scale basate su WDI massimo osservabile per categoria: Short 10→50, Medium 15→90, Long 30→130, Ultra invariata. |
| 10/06/2026 | WDI_NORM_CATEGORIES + NORM_GAMMA | v4 (lineare) | v5: i massimi v4 erano superati da gare competitive (5 Short al 10/10 nel ranking, es. Skyrace Comapedrosa WDI 76.1). Massimi alzati al 95° percentile osservato (Short 50→80, Medium 90→100, Long 130→160) + curva power norm = x^0.65 × 10 per sollevare i valori bassi senza schiacciare i medi-alti. Verificato su 34 gare: nessun cap tranne TOR330 (Legend∞), spread 4.7–9.6 su Short. |

### Pipeline di calibrazione

GitHub Actions: `POST /api/hub?action=run` → trigger workflow → risultati `PATCH /api/hub?action=patch`. Richiede `HUB_SECRET_TOKEN` e `GITHUB_TOKEN`.

---

## PWA

- `manifest.webmanifest` — start_url: `/`, display: standalone, theme: `#002b2b`
- Icone: `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable.svg` (safe zone 80% su background full-bleed `#002b2b`)
- Web Share Target: accetta file GPX/TCX/XML tramite POST a `/index.html`
- Service Worker gestisce la coda share in `wiztrail-share-queue` cache

---

## Problemi noti (non toccare senza analisi)

| Problema | File | Note |
|---|---|---|
| `window.currentWDI_norm` non usata | main.js:25,421 | Riservata per display futuro |
| `window.lastOsmResult` sempre null | main.js:27,417 | Feature OSM rimossa |
| `#btnFit` e `#btnKml` non nel DOM | main.js:283,288 | Handler mai attivi, safe `?.` |
| `#pacingElevCanvas` non nel DOM | wiztrail-pacing.js | Canvas non implementato |
| `#fatica` nel form ma non nel calcolo | index.html | Incluso solo in export JSON |

---

## Regole di sviluppo

1. **Branch di lavoro:** crea sempre un branch da `backend`. Non pushare direttamente su `backend`.
2. **PR → backend:** tutto passa da PR. Merge squash preferito.
3. **Bump cache SW:** ogni modifica a file statici richiede aggiornamento `CACHE_VERSION` in `service-worker.js`.
4. **Sync engine-node.js:** qualsiasi modifica a `wiztrail-engine.js` va replicata in `api/lib/engine-node.js`.
5. **Vercel function limit:** 11/12 usate. Non aggiungere file in `/api/` senza consolidare.
6. **Nessun framework frontend:** tutto plain JS IIFE + globali. Non introdurre build tools.
7. **CSS unico:** tutte le nuove regole in `wiztrail.css`. Nessun file CSS separato.
8. **Lingua:** tutta l'interfaccia utente in italiano. Commenti nel codice in italiano.

---

## Roadmap (stato al 09/06/2026)

### In produzione
- WDI engine v5.1 con TechScore
- Pacing su segmenti v2.0
- Calcolo manuale senza GPX
- Strava integration (OAuth + import attività)
- Ranking + Dettaglio gara
- Share Card (og:image generata)
- Training Analyzer
- Feedback anonimo post-gara
- Trail Identity Card (trail-card.html) — statistiche dettagliate + radar chart + insights

### Pianificato (beta)
- ~~Fase 12 — Athlete Profile~~ **IN PRODUZIONE (10/06/2026):** `T_finale = T_segmenti × terrainFactor(TechScore, S)`. KF usa TechScore (non WDI — vedi nota in sezione timing). Parametri `KF_TERRAIN_PARAMS` calibrabili via hub patch senza deploy.
- API Suunto: import route GPX + SuuntoPlus Guides (push pacing su orologio). Contatto: janne.kallio@suunto.com. Variabili: `SUUNTO_CLIENT_ID`, `SUUNTO_CLIENT_SECRET`. Implementare in singolo `api/suunto.js` (pattern hub).
- Terrain 3D Viewer (webGL, bassa priorità)

### Non fare
- **Non migrare Strava a `www.api-v3.strava.com`** — dominio non live (ECONNREFUSED verificato 05/06/2026)
- **Non aggiungere framework JS** — architettura plain JS è una scelta deliberata
- **Non separare wiztrail.css** — file unico è una scelta deliberata
