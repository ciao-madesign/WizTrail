# WizTrail — Internal API Reference

Documentazione degli endpoint serverless già deployati su Vercel.  
Tutti gli endpoint sono in `api/` e usano il formato **ES Module** (`export default async function handler(req, res)`).

> Per la futura **public API v1** (`/api/v1/wdi`, `/api/v1/pacing`) vedi la milestone M5 su Notion.

---

## Autenticazione Hub

Il sistema hub usa due token distinti, configurati come env vars su Vercel:

| Token | Env var | Permessi |
|---|---|---|
| Token utente | `HUB_SECRET_TOKEN` | Upload GPX, lettura proprie attività, avvio pipeline (se autorizzato) |
| Token admin | `HUB_ADMIN_TOKEN` | Tutto + lettura tutte le attività, reset pipeline, gestione runner |

Il token viene letto da (in ordine di priorità):
1. Header `X-Hub-Key`
2. Query param `?key=TOKEN`
3. Body JSON campo `key`

---

## Hub API

### `GET /api/hub/auth`

Verifica il token e restituisce il ruolo. Usato dal frontend all'avvio per sapere se mostrare i controlli admin.

**Auth:** token utente o admin

**Response `200`:**
```json
{ "ok": true, "isAdmin": false }
```

**Errori:** `401 Token mancante`, `401 Token non valido`, `500 Config mancante`

---

### `POST /api/hub/upload`

Carica un GPX con metadati per la calibrazione.

**Auth:** token utente o admin

**Body JSON:**
```json
{
  "alias":        "string (obbligatorio) — nickname anonimo dell'utente",
  "name":         "string (obbligatorio) — nome gara/attività",
  "type":         "personal | reference",
  "gpx_base64":   "string (obbligatorio) — GPX codificato base64, max ~5MB",
  "gpx_filename": "string (opzionale) — nome file originale",
  "km":           42.5,
  "dplus":        2300,
  "time_hours":   5.25,
  "technicality": 7.0,
  "tech_label":   "runnable | mixed | technical | alpine | extreme",
  "comment":      "string (opzionale)"
}
```

**Response `200`:**
```json
{ "ok": true, "id": "uuid-v4", "wdi_estimate": 87.3 }
```

**Errori:** `400 Dati non validi` con array `details`, `401`, `405`

**Note:**
- `wdi_estimate` è calcolato server-side con parametri v5.1 (sincronizzare con `wiztrail-engine.js` se i parametri cambiano)
- Le attività vengono salvate in Redis con chiave `hub:activities:{uuid}` con status `pending`
- Il GPX base64 è incluso nel payload Redis — campo `gpx_base64` escluso dalle risposte di lettura

---

### `GET /api/hub/activities`

Recupera le attività e i dati del modello corrente.

**Auth:** token utente o admin  
**Query params:** `?key=TOKEN&alias=ALIAS`

**Response `200`:**
```json
{
  "ok": true,
  "activities": [...],
  "stats": {
    "n_total": 47,
    "n_pending": 3,
    "last_run": "2026-04-28T10:00:00.000Z",
    "last_rmse": 13.51,
    "pipeline_running": false,
    "pipeline_started_at": null,
    "pipeline_started_by": null
  },
  "model": {
    "wdi_calibration": {...},
    "pacing": {...},
    "timestamp": "ISO",
    "patch_js": "// JS patch..."
  },
  "plots": {
    "wdi_scatter": "base64...",
    "history_rmse": "base64...",
    "insights_distribution": "base64...",
    "insights_tech_vs_wdi": "base64...",
    "insights_spread": "base64..."
  },
  "report_md": "# Report...",
  "isAdmin": true,
  "authorized_runners": ["alice", "bob"]
}
```

**Differenze per ruolo:**
- **Utente:** vede solo le proprie attività (filtrate per `alias`), `authorized_runners` è `null`
- **Admin:** vede tutte le attività, include `authorized_runners`

Il campo `gpx_base64` è rimosso da tutte le attività nella risposta.

---

### `POST /api/hub/run`

Avvia la pipeline di calibrazione su GitHub Actions.

**Auth:** token admin, oppure token utente se l'alias è nella lista `hub:authorized_runners`

**Body JSON:**
```json
{ "alias": "string" }
```

**Response `200`:**
```json
{ "ok": true, "message": "Pipeline avviata su GitHub Actions", "started_at": "ISO" }
```

**Errori:**
- `403 Non autorizzato ad avviare la pipeline`
- `409 Pipeline già in corso` con `started_at` e `started_by`
- `500` se `GITHUB_TOKEN` o `GITHUB_REPO` non configurati

**Note:**
- Triggera un `repository_dispatch` event di tipo `hub_calibration` su GitHub
- Auto-reset del flag `pipeline_running` se bloccato da più di 40 minuti
- `GITHUB_REPO` deve essere nel formato `owner/repo`

**Env vars richieste:** `GITHUB_TOKEN`, `GITHUB_REPO`

---

### `POST /api/hub/patch`

Riceve i risultati della pipeline di calibrazione da GitHub Actions (via `06_push_results.py`).

**Auth:** token admin obbligatorio

**Body JSON (da pipeline):**
```json
{
  "key": "ADMIN_TOKEN",
  "wdi_calibration": { "rmse_before": 32.99, "rmse_after": 13.51, "weights": {...} },
  "timing": { "k_base": 1.5, "k_spread": 2.5, ... },
  "stats": { "n_races_total": 96, "n_races_gpx": 47 },
  "plots": { "wdi_scatter": "base64...", "timing_scatter": "base64...", ... },
  "plot_rmse_base64": "base64...",
  "report_md": "# Insights...",
  "patch_js": "// BLOCCO A — wiztrail-engine.js\n..."
}
```

**Body (reset pipeline manuale):**
```json
{ "_reset_pipeline": true }
```

**Response `200`:**
```json
{ "ok": true, "timestamp": "ISO", "rmse": 13.51 }
```

**Dati salvati in Redis:**
- `hub:model:current` — modello corrente
- `hub:model:history:{timestamp}` — storico
- `hub:plot:{name}` — grafici PNG in base64
- `hub:report:md` — report markdown
- `hub:stats` — statistiche aggiornate con `pipeline_running: false`
- Tutte le attività `pending` → `calibrated`

---

### `POST /api/hub/feedback`

Raccoglie feedback anonimo post-gara (scarto % tra tempo stimato e reale).

**Auth:** nessuna — endpoint pubblico  
**Rate limit:** 10 req/min per IP (più restrittivo degli altri endpoint)

**Body JSON:**
```json
{
  "delta_pct": -8.3,
  "km": 42.0,
  "dplus": 2300,
  "ts": 1714300000000
}
```

**Response `200`:**
```json
{ "ok": true, "id": "1714300000000-abc123" }
```

**Note:**
- `delta_pct` deve essere tra −300% e +300%
- Dati salvati con TTL 90 giorni (`hub:feedback:{id}`)
- Nessun dato personale raccolto
- Statistiche aggregate in `hub:feedback:stats`

---

## Strava API

Tutti gli endpoint Strava usano **rate limiting 30 req/min per IP** via Upstash Redis.  
L'autenticazione è tramite `Authorization: Bearer {strava_access_token}` nell'header.  
Il token Strava viene ottenuto tramite OAuth2 e salvato in `sessionStorage` (mai `localStorage`).

### `GET /api/strava/callback`

Scambia il codice OAuth con un access token Strava. Chiamato da `auth_strava.html` dopo il redirect.

**Auth:** nessuna (parametro `?code=` da Strava)  
**Query params:** `?code=OAUTH_CODE`

**Response `200`:**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": 1714300000,
  "athlete": { "id": 12345, "firstname": "Mario", "lastname": "R." }
}
```

**Errori:** `400 Invalid or missing code`, `500 Server configuration error`, `502` se Strava non risponde

**Note:**
- `STRAVA_CLIENT_ID` e `STRAVA_CLIENT_SECRET` rimangono server-side
- Il codice OAuth è validato con regex `/^[a-zA-Z0-9_\-]{1,100}$/`
- **Security gap aperto (#9):** manca il parametro `state` anti-CSRF — da aggiungere prima del lancio

**Env vars richieste:** `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`

---

### `GET /api/strava/activities`

Lista le attività recenti dell'atleta autenticato.

**Auth:** `Authorization: Bearer {strava_token}`

**Response `200`:** array di attività Strava (forward diretto dalla Strava API v3)

**Errori:** `401 Missing or invalid authorization`, `429 Too many requests`, `502` se Strava non risponde

---

### `GET /api/strava/activity`

Recupera i dati di una singola attività (streams GPS + altimetria).

**Auth:** `Authorization: Bearer {strava_token}`  
**Query params:** `?id={activityId}` oppure `?id={activityId}&mode=analyze`

**Modalità raw** (default):
```
Response 200: { latlng: [...], altitude: [...], distance: [...], time: [...] }
```

**Modalità analyze** (`?mode=analyze`):
```
Response 200: { pts: [[lat,lon,ele],...], metrics: { km, gain, e[], d[] }, movingTime: 3600 }
```

La modalità `analyze` è usata da `training-analyzer.html` per passare i dati direttamente a `WizTrailTiming.computeTime()`.

**Errori:** `400 Missing activity ID`, `401`, `429`, `502`

---

## Rate limiting

Implementato in `api/lib/ratelimit.js` tramite Upstash Redis con sliding window.

| Endpoint | Limite |
|---|---|
| `/api/strava/*` | 30 req/min per IP |
| `/api/hub/feedback` | 10 req/min per IP |
| `/api/hub/*` (altri) | nessun rate limit esplicito (protetti da token) |

**Env vars richieste:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

**Security gap aperto (#7):** in caso di errore Redis, il rate limiting fallisce in modalità open (permette la richiesta). Aggiungere log/alert esplicito prima del lancio.

---

## Env vars — riepilogo completo

| Variabile | Usata da | Note |
|---|---|---|
| `STRAVA_CLIENT_ID` | `api/strava/callback.js` | App Strava |
| `STRAVA_CLIENT_SECRET` | `api/strava/callback.js` | Mai esposto al client |
| `UPSTASH_REDIS_REST_URL` | Tutti gli endpoint hub + ratelimit | |
| `UPSTASH_REDIS_REST_TOKEN` | Tutti gli endpoint hub + ratelimit | |
| `HUB_SECRET_TOKEN` | `api/hub/auth.js` | Token accesso base hub |
| `HUB_ADMIN_TOKEN` | `api/hub/auth.js` | Token admin hub |
| `GITHUB_TOKEN` | `api/hub/run.js` | PAT con `repo` scope |
| `GITHUB_REPO` | `api/hub/run.js` | Formato `owner/repo` |

---

## Redis — struttura chiavi

| Pattern | Contenuto |
|---|---|
| `hub:activities:{uuid}` | Singola attività con GPX base64 |
| `hub:stats` | Statistiche globali + stato pipeline |
| `hub:model:current` | Ultimi parametri calibrati |
| `hub:model:history:{ISO}` | Storico calibrazioni |
| `hub:plot:{name}` | Grafici PNG in base64 (`wdi_scatter`, `history_rmse`, `timing_scatter`, ...) |
| `hub:report:md` | Report markdown ultimo calibration run |
| `hub:authorized_runners` | Array alias autorizzati ad avviare la pipeline |
| `hub:feedback:{id}` | Feedback anonimo post-gara (TTL 90gg) |
| `hub:feedback:stats` | Statistiche aggregate feedback |
