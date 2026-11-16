# WizTrail — Internal API Reference

Documentazione degli endpoint serverless.  
Gli endpoint sono in `api/` (**7 file**: il piano Vercel Hobby consente 12 function e conta ogni `.js` sotto `api/`) e usano il formato **ES Module** (`export default async function handler(req, res)`). Le librerie condivise stanno in **`server/`** (fuori da `api/`, non sono function). L'API pubblica v1 (`/api/v1/analyze`, `/api/v1/wdi`) è documentata in `docs/api-public.md`.

> **Hub:** tutte le azioni sono `GET|POST /api/hub?action=<azione>` (un solo file, `api/hub.js`). Nel resto del documento le intestazioni `/api/hub/<azione>` indicano la stessa azione, ad esempio `/api/hub/auth` = `/api/hub?action=auth`.
>
> **Ambienti:** in produzione le chiavi Redis hanno prefisso `wiztrail:`; in preview/sviluppo/locale `wiztrail:<ambiente>:` (`server/redis.js`). Le azioni `run`, `register` e `requestkey` rispondono `403 PREVIEW_DISABLED` fuori da production.

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
**Rate limit:** 5 req/min per IP (scope `feedback`, più restrittivo degli altri endpoint)

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

### `register`, `listkeys`, `revokekey` (admin)

Gestione delle API key dinamiche (`POST ?action=register` crea, `GET ?action=listkeys` elenca, `POST ?action=revokekey` revoca). Richiedono il token admin. **Nessun client le usa** (solo chiamate dirette). `register` risponde `403 PREVIEW_DISABLED` fuori da production. Le chiavi sono salvate in `apikeys:{key}` (indice `apikeys:_index`) e verificate da `server/auth.js` insieme a `API_KEYS`.

### `POST /api/hub?action=requestkey` (pubblica, SPENTA)

Self-service: l'utente indica un'email e riceve la chiave via Resend. **Spenta fuori da production e senza form UI nel sito: non rilasciare senza un form e senza verificare il dominio mittente Resend.** Comportamento: risposta sempre neutra (`{ok:true, message}`, nessuna enumerazione delle email), limite 3 richieste/ora per IP e 1 ogni 10 minuti per indirizzo, `description` pulita (max 80 caratteri) ed escapata nell'HTML dell'email, errori `{ok:false, code}` (`INVALID_EMAIL`, `RATE_LIMITED`, `REQUESTKEY_FAILED`, `EMAIL_NOT_CONFIGURED`).

---

## Import GPX da URL

### `GET /api/import/url?url=<URL>`

Scarica un file GPX/TCX da un link diretto (il browser non può farlo per CORS). **Auth:** nessuna. **Rate limit:** 10 req/min per IP (scope `import`).

Protezione SSRF in `server/netguard.js`: solo http/https su porte 80/443, niente credenziali nell'URL, IP privati/riservati v4/v6 bloccati (anche con parentesi e IPv4-mapped), DNS risolto e validato con pinning, redirect manuali (max 3), timeout 8 s, tetto 5 MB.

**Response `200`:** il file (`application/gpx+xml`). **Errori:** JSON `{ ok:false, code, error }` con testo italiano: `MISSING_URL`/`INVALID_URL`/`UNSUPPORTED_SCHEME`/`BLOCKED_HOST`/`BLOCKED_PORT` (400), `HTML_PAGE`/`NOT_GPX` (422), `TOO_LARGE` (413), `RATE_LIMITED` (429), `UPSTREAM_ERROR`/`UPSTREAM_UNREACHABLE`/`TOO_MANY_REDIRECTS` (502), `UPSTREAM_TIMEOUT` (504).

---

## Strava API (SPENTA — "Non ancora disponibile")

> Gli endpoint sono nel repo ma **spenti**: senza `STRAVA_ENABLED=true` rispondono `503 {ok:false, code:'FEATURE_UNAVAILABLE', feature:'strava', error:<italiano>}` prima di qualsiasi chiamata a Strava. Il client ha il flag corrispondente `WizFeatures.stravaEnabled` in `features.js`. Le descrizioni sotto valgono con il flag acceso.

Tutti gli endpoint Strava usano **rate limiting 30 req/min per IP** (scope `strava`) via Upstash Redis.  
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

Implementato in `server/ratelimit.js` tramite Upstash Redis con **finestra fissa**: `INCR` + `EXPIRE ... NX` (il TTL di 60 s si imposta alla prima richiesta e non viene rinnovato; fallback senza `NX` per Redis < 7). Contatori separati per scope (`wiztrail:ratelimit:<scope>:<ip>` in production).

| Endpoint | Scope | Limite |
|---|---|---|
| `/api/import/url` | `import` | 10 req/min per IP |
| `/api/strava/*` | `strava` | 30 req/min per IP |
| `/api/hub?action=feedback` | `feedback` | 5 req/min per IP |
| `/api/v1/*` | `v1` | 30 req/min per IP, **prima** della verifica della chiave |
| `requestkey` | dedicato | 3/ora per IP, 1/10 min per email |
| `/api/hub` (altre azioni) | — | nessun rate limit esplicito (protette da token) |

Risposta 429: `Retry-After` e `{ ok:false, code:'RATE_LIMITED', error }` (testo italiano).

**Env vars richieste:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

**Fail-open:** se Redis non è configurato o non risponde il rate limiting lascia passare la richiesta (viene loggato l'errore): da monitorare.

---

## Env vars — riepilogo completo

| Variabile | Usata da | Note |
|---|---|---|
| `STRAVA_ENABLED` | `api/strava/*` (`server/features.js`) | `true` riattiva Strava; default spenta |
| `STRAVA_CLIENT_ID` | `api/strava/callback.js` | App Strava (solo con Strava attiva) |
| `STRAVA_CLIENT_SECRET` | `api/strava/callback.js` | Mai esposto al client |
| `UPSTASH_REDIS_REST_URL` | `api/hub.js`, `server/ratelimit.js`, `server/auth.js` | |
| `UPSTASH_REDIS_REST_TOKEN` | `api/hub.js`, `server/ratelimit.js`, `server/auth.js` | |
| `HUB_SECRET_TOKEN` | `api/hub.js` | Token accesso base hub |
| `HUB_ADMIN_TOKEN` | `api/hub.js` | Token admin hub |
| `GITHUB_TOKEN` | `api/hub.js` (`run`) | PAT con `repo` scope |
| `GITHUB_REPO` | `api/hub.js` (`run`) | Formato `owner/repo` |
| `API_KEYS` | `server/auth.js` | Chiavi API v1 statiche (comma-separated) |
| `RESEND_API_KEY` / `RESEND_FROM` | `api/hub.js` (`requestkey`) | Email della chiave; azione spenta fuori da production |
| `VERCEL_ENV` | `server/redis.js`, `server/ambiente.js` | Impostata da Vercel: `production` / `preview` / `development` |

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

**Prefisso:** i pattern sopra valgono per l'ambiente production (prefisso `wiztrail:`). In preview/sviluppo/locale il prefisso è `wiztrail:<ambiente>:`. Altre chiavi: `apikeys:{key}`, `apikeys:_index`, `apikeys:email:{email}`, `ratelimit:{scope}:{ip}`, `rl:reqkey:*`.
