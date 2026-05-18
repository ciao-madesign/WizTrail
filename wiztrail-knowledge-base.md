# WizTrail — Knowledge Base (Fase 5.5 Beta Launch Prep)

Data aggiornamento: 2026-05-18  
Branch principale: `backend` (deployed su Vercel)  
Repository: `ciao-madesign/WizTrail`

---

## 1. Cos'è WizTrail

WizTrail è una piattaforma web per l'analisi tecnica dei percorsi trail running. Funziona interamente nel browser (no backend per i calcoli principali), calcola la difficoltà di un percorso a partire da un file GPX e stima il tempo di gara personalizzato.

### Funzionalità principali

- **Calcolatore WDI** (`index.html`): carica GPX, inserisce tempo 10K, ottiene WDI (Wiztrail Difficulty Index) e stima tempi con margine
- **Training Analyzer** (`training-analyzer.html`): analisi post-gara con confronto Strava
- **Ranking** (`ranking.html`): classifica gare per difficoltà con TechScore calcolato da GPX
- **Pacing Planner** (`wiztrail-pacing.js`): piano di pacing per checkpoint
- **Hub** (`hub.html`): area atleta con alias e storico
- **Share Card** (`share_card.html`): card condivisibile con mappa e WDI

### Architettura

- Plain JS, nessun framework, nessun bundler
- Moduli IIFE esposti come globals: `window.WizTrail`, `window.WizUI`, `window.WizMap`, `window.GPXParser`, `window.WizTrailTiming`
- File principali: `wiztrail-engine.js`, `wiztrail-timing.js`, `wiztrail-pacing.js`, `gpx-parser.js`, `main.js`, `ui.js`, `map.js`
- Hosting: Vercel (branch `backend` = produzione)
- Redis per feedback anonimo (TTL 90 giorni)
- Strava OAuth opzionale per Training Analyzer

---

## 2. Modello di calcolo

### WDI (Wiztrail Difficulty Index)

```
WDI = (VolumeScore + TechScore × 0.50) × DistFactor × AltFactor
```

- **VolumeScore**: basato su D+ e D- (dislivello positivo/negativo)
- **TechScore**: basato su FRIP, SlopeVariance, Roughness, D+/km — pesi calibrati su 96 gare / 47 GPX reali
- **DistFactor**: esponente 0.48 per ridurre la dominanza distanza sulle ultra
- **AltFactor**: penalità da quota media (>1300m)
- **kT = 0.50**: calibrato 20/04/2026

### SURFACE_MULT (modificatore fondo percorso)

```javascript
const SURFACE_MULT = { 1: 0.92, 2: 0.97, 3: 1.00, 4: 1.04, 5: 1.08 };
```

Applicato al TechScore. Livelli: 1=asfalto/sterrato compatto, 2=sentiero battuto, 3=trail misto (default), 4=roccioso/sassoso, 5=fango/neve/erba alta. Impatto sul WDI finale: ±1–3% per gare standard, fino a ±4% per VK molto tecnici.

### Stima tempi (WizTrailTiming)

Modello a segmenti: ogni segmento GPX viene stimato con `velocityFromSlope(p, S, velBase)` dove:
- `p` = pendenza del segmento
- `S` = specificità trail [0=principiante, 1=elite] — dallo slider "Livello"
- `velBase` = velocità base su piano da tempo 10K

Fattori aggiuntivi: meteo, altitudine, fatica progressiva. Il modello di stima tempi **non usa** `surfaceLevel` (che incide solo sul WDI).

### TRAIL_BASE_FACTOR

```javascript
{ 'Strada': 1.00, 'E': 1.00, 'EE': 0.85, 'EA': 0.75 }
```

Riduzione velocità base per tecnicità del terreno sui tratti pianeggianti.

---

## 3. Fase 5.5 — Beta Launch Prep (completata)

Tutte le seguenti PR sono mergiate su `backend` e in produzione.

### PR #57 — Rimozione Vercel Speed Insights

**Problema**: Speed Insights trasmetteva automaticamente Core Web Vitals a Vercel su ogni pagina, senza dichiarazione in privacy policy. Il sito affermava "nessun dato inviato a server" — affermazione non più accurata.

**Fix**: rimosso il blocco di 2 righe da tutti gli 11 file HTML:
```html
<script>window.si=window.si||function(){(window.siq=window.siq||[]).push(arguments);};</script>
<script defer src="/_vercel/speed-insights/script.js"></script>
```

**File modificati**: `index.html`, `about.html`, `landing.html`, `ranking.html`, `training-analyzer.html`, `hub.html`, `share_card.html`, `auth_strava.html`, `import_strava.html`, `dettaglio.html`, `install.html`

**Meta description corretta**: `"nessun dato inviato a server"` → `"nessun dato personale inviato a server"` (×2: `<meta>` e schema.org JSON-LD in `index.html`)

---

### PR #58 — Privacy Policy GDPR

**File creato**: `/privacy.html`

**Contenuto**:
- Cosa non raccogliamo (nessun dato personale dai calcoli — tutto locale)
- Log Vercel hosting (IP anonimizzato, standard hosting, base legittimo interesse)
- Feedback anonimo opt-in (Redis, TTL 90 giorni, anonimo per design)
- Strava OAuth (solo se l'utente attiva il Training Analyzer)
- localStorage locale (preferenze tema, GPX temporaneo — resta nel browser)
- Tabella terze parti (Vercel hosting, Strava API, Leaflet/OpenStreetMap tiles)
- Diritti GDPR (accesso, cancellazione, portabilità)
- Contatto: `ciao.madesign@gmail.com`

**Note tecniche**: `<meta name="robots" content="noindex, nofollow">` — non indicizzata. Struttura identica ad `about.html`. Aggiunto `Allow: /privacy.html` in `robots.txt`.

---

### PR #59 — Sitemap + Service Worker

**`sitemap.xml`**: aggiornati tutti i 7 `lastmod` da `2026-05-05` a `2026-05-18`. `privacy.html` NON aggiunta (noindex).

**`service-worker.js`**:
- `CACHE_VERSION`: `"wiztrail-v2026-05-13a"` → `"wiztrail-v2026-05-18a"`
- Aggiunto `/privacy.html` a `PAGE_CACHE`

---

### PR #60 — Badge BETA + feedback mailto

**Footer aggiornato** in tutte le pagine principali (`index.html`, `about.html`, `landing.html`, `ranking.html`, `training-analyzer.html`):

```html
<span style="...background:rgba(247,150,23,0.15);color:#F79617;...">BETA</span>
&nbsp;·&nbsp;<a href="mailto:ciao.madesign@gmail.com?subject=WizTrail%20beta%20feedback">Invia feedback</a>
&nbsp;·&nbsp;<a href="privacy.html">Privacy</a>
```

**Obiettivo**: segnalare agli utenti che il prodotto è in fase beta e offrire un canale di feedback immediato senza infrastruttura aggiuntiva.

---

### PR #61 — alert() → messaggi inline

**Problema**: 18 chiamate `alert()` sparse in 7 file bloccavano il thread del browser, mostravano il chrome del sistema operativo e rompevano l'esperienza UI di WizTrail.

**Soluzione**: sostituiti con messaggi inline in elementi `<div>` dedicati, usando i colori e gli stili esistenti (`var(--accent)`, classe `.mini`).

**File modificati**:

| File | Alert sostituiti | Elemento messaggio |
|------|-----------------|-------------------|
| `main.js` | 1 (GPX mancante) | `WizUI.showError()` esistente |
| `wiztrail-pacing.js` | 3 (GPX, formato tempo, errore calcolo) | `showPcError()` + `#pc_msg` in `index.html` |
| `training-analyzer.html` | 5 (GPX, Strava, errori API) | `showTaError()` + `#taMsg` |
| `hub.html` | 2 (alias troppo corto, caratteri non validi) | `#aliasMsg` nella funzione `confirmAlias()` |
| `ranking.html` | 6 (click tabella, form admin, form utente) | `showRankMsg()` + `showAdminMsg()` + `#userComputeMsg` |
| `share_card.html` | 1 (attendi caricamento mappa) | `#shareMsg` inline |

**Dettaglio `wiztrail-pacing.js`**: opera sul DOM di `index.html`. Helper aggiunto:
```javascript
function showPcError(msg) {
  const el = document.getElementById('pc_msg');
  if (el) el.textContent = msg;
}
```
Errore azzerato dopo calcolo pacing riuscito: `showPcError('')`.

---

### PR #62 — Selettore fondo percorso

**Problema**: `SURFACE_MULT` esisteva nel motore ma `main.js` passava sempre `null` a `computeFromGpx` → surfaceLevel sempre 3 (neutro) → il parametro era inutilizzabile.

**Fix in `index.html`**: aggiunto nel fieldset "Tecnica del percorso":
```html
<label style="margin-top:8px;">Fondo</label>
<select id="surfaceLvl">
  <option value="1">Asfalto / sterrato compatto</option>
  <option value="2">Sentiero battuto</option>
  <option value="3" selected>Trail misto</option>
  <option value="4">Roccioso / sassoso</option>
  <option value="5">Fango / neve / erba alta</option>
</select>
<p class="mini" style="opacity:0.6;margin:4px 0 0;">Modifica la componente tecnica del WDI (effetto tipico ≤3%)</p>
```

**Fix in `main.js`**:
```javascript
const surfaceLvl = parseInt(document.getElementById('surfaceLvl')?.value || '3', 10);
// passato a computeFromGpx (era null) e computeManual (era assente)
```

**Regressioni**: `dettaglio.html`, `training-analyzer.html`, `ranking.html` chiamano `computeFromGpx` senza `surfaceLevel` → fallback `|| 3` nel motore → neutro, nessuna variazione.

---

## 4. Decisioni architetturali prese durante la sessione

### CSRF su /api/hub/feedback — rimandato

L'endpoint hub è accessibile solo a beta tester selezionati con istruzioni specifiche. Rate limit: 1 req/min per IP. CSRF non necessario per beta chiusa. Da rivalutare in Fase 9 (Security Hardening).

### Canale feedback — mailto (non form)

Scelta consapevole: zero infrastruttura aggiuntiva, nessuna dipendenza esterna, immediato da implementare. Un form strutturato (Google Form / Tally) sarà creato manualmente e inviato ai tester nell'email di onboarding — non è un task di codice.

### Speed Insights — rimosso completamente

Alternativa considerata: dichiararlo in privacy policy. Scelta finale: rimozione totale per coerenza con il principio "nessun dato personale inviato a server" e per semplificare la privacy policy.

---

## 5. Stato attuale (2026-05-18)

### Pronto per beta chiusa ✅

Tutto il codice di Fase 5.5 è in produzione su `backend` (Vercel). I beta tester possono:
- Usare il calcolatore, training analyzer, ranking, pacing planner
- Vedere il badge BETA in ogni pagina
- Inviare feedback via mailto dal footer
- Leggere la privacy policy

### Deferred (post-beta / post-launch)

| Item | Motivazione rinvio |
|------|-------------------|
| WCAG Elite color `#E91E63` (4.35:1 contrast ratio) | Sotto soglia AA (4.5:1) di 0.15 punti — documentato, impatto estetico minimo |
| D+ isteresi universale | Richiede ricalibrare il modello completo — Fase 8 |
| CSRF /api/hub/feedback | Non necessario per beta chiusa con tester selezionati |
| Form feedback strutturato (Tally/Google Form) | Task esterno, non bloccante — da creare e includere nell'email di onboarding |

---

## 6. File principali e loro ruolo

| File | Ruolo |
|------|-------|
| `index.html` | Calcolatore principale (WDI + stima tempi) |
| `main.js` | Controller calcolatore — legge form, chiama engine e timing, aggiorna UI |
| `wiztrail-engine.js` | Motore WDI: `computeFromGpx()`, `computeManual()`, `SURFACE_MULT` |
| `wiztrail-timing.js` | Stima tempi a segmenti: `computeTime()`, `velocityFromSlope()`, `levelFromS()` |
| `wiztrail-pacing.js` | Pacing planner per checkpoint, opera sul DOM di `index.html` |
| `gpx-parser.js` | Parser multi-formato (GPX/TCX/SML), sanitizzazione, Douglas-Peucker |
| `ui.js` | `WizUI.showWDI()`, `WizUI.showResults()`, `WizUI.showError()` |
| `map.js` | `WizMap` — Leaflet, drawTrack, fitTrack, clearTrack |
| `training-analyzer.html` | Analisi post-gara + integrazione Strava |
| `ranking.html` | Classifica gare con TechScore auto-calcolato da GPX in background |
| `hub.html` | Area atleta con alias |
| `share_card.html` | Card condivisibile |
| `privacy.html` | Privacy policy GDPR (noindex) |
| `service-worker.js` | Cache offline — versione attuale: `wiztrail-v2026-05-18a` |
| `sitemap.xml` | 7 URL indicizzate, lastmod `2026-05-18` |

---

## 7. Roadmap Notion (sintesi)

- **Fase 5** (completata): funzionalità core — WDI, timing, pacing, ranking, share card
- **Fase 5.5** (completata): Beta Launch Prep — privacy, GDPR, UX, feedback channel
- **Fase 6**: da definire in base ai feedback della beta
- **Fase 8**: D+ isteresi universale, ricalibrazione modello
- **Fase 9**: Security Hardening (CSRF, rate limiting avanzato)

---

## 8. Contatti e repository

- Email: `ciao.madesign@gmail.com`
- GitHub: `https://github.com/ciao-madesign/WizTrail`
- Produzione: `https://wiz-trail.vercel.app`
