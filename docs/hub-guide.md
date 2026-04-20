# WizTrail Hub — Guida Completa

_Versione 1.0 — Aprile 2026_

---

## Indice

1. [Cos'è l'Hub e a cosa serve](#1-cosè-lhub-e-a-cosa-serve)
2. [Architettura tecnica](#2-architettura-tecnica)
3. [Token e accesso](#3-token-e-accesso)
4. [Guida Utente](#4-guida-utente)
5. [Guida Admin](#5-guida-admin)
6. [Esempi di output reali](#6-esempi-di-output-reali)
7. [Soluzione problemi](#7-soluzione-problemi)
8. [Variabili d'ambiente](#8-variabili-dambiente)

---

## 1. Cos'è l'Hub e a cosa serve

Il WizTrail Hub è un sistema di autotraining che migliora automaticamente i modelli WDI e stima tempi attraverso dati reali forniti dagli utenti.

**Flusso di lavoro:**

1. Un utente carica una traccia GPX con tempo di completamento e valutazione tecnicità
2. I dati vengono salvati su Redis in attesa di calibrazione
3. L'admin avvia la pipeline su GitHub Actions che ricalibra i parametri del motore
4. I nuovi parametri vengono salvati come patch da applicare al codice

### 1.1 Cosa viene calibrato

- I 9 pesi di `buildTechScore()` (FRIP, SlopeVar, Roughness, VertInt)
- I parametri del modello power-law: A, alpha, beta, c, delta
- `pace10km_ref` — riferimento base per lo scaling del livello atleta

### 1.2 Cosa NON viene calibrato dall'hub

- `kT` — peso della tecnica sul WDI (impostato manualmente in `wiztrail-engine.js`)
- Esponente di `DistFactor` (attualmente 0.48)
- Soglie WDI per classe (Sport/Pro/Advanced/Extreme/Elite/Legend)

> Questi parametri si aggiornano manualmente dopo analisi dei risultati della pipeline, sincronizzando `wiztrail-engine.js`, `map.js` e `ui.js`.

---

## 2. Architettura tecnica

### 2.1 Stack tecnologico

| Componente | Tecnologia | Ruolo |
|---|---|---|
| Frontend Hub | HTML/CSS/JS vanilla (`hub.html`) | Interfaccia utente |
| API Backend | Vercel Serverless Functions (Node.js ES Module) | 5 endpoint REST |
| Persistenza | Upstash Redis (REST API) | Storage attività e modello |
| Pipeline ML | GitHub Actions + Python 3.11 | Calibrazione su ogni run |
| Protezione | Vercel Deployment Protection + bypass token | Accesso autenticato |

### 2.2 Flusso dati

**Upload utente:**
1. Apre `hub.html?key=TOKEN` → autenticazione via `GET /api/hub/auth`
2. Carica GPX → conversione base64 a chunk 8KB nel browser
3. `POST /api/hub/upload` → salva su `hub:activities:{id}` + aggiorna `hub:stats`

**Calibrazione:**
1. Admin preme "Avvia" → `POST /api/hub/run` → triggera `repository_dispatch`
2. GitHub Actions: `01→02→03→04→05→06_push_results.py`
3. `06_push_results.py` invia a `POST /api/hub/patch` con header `x-vercel-protection-bypass`
4. `patch.js` salva modello, 6 grafici PNG, report markdown su Redis
5. `patch.js` resetta `pipeline_running: false` e crea branch `model-update` con patch JS

### 2.3 Struttura Redis

| Chiave | Contenuto |
|---|---|
| `hub:activities:{id}` | Attività utente completa (incluso GPX base64) |
| `hub:stats` | n_total, n_pending, last_run, last_rmse, pipeline_running |
| `hub:model:current` | wdi_calibration, pacing, stats, timestamp, patch_js |
| `hub:model:history:{ts}` | Snapshot storico di ogni calibrazione |
| `hub:plot:{name}` | Grafici PNG in base64 (6 nomi: history_rmse, wdi_scatter, pacing_scatter, insights_distribution, insights_tech_vs_wdi, insights_spread) |
| `hub:report:md` | Report Markdown dell'ultima calibrazione |
| `hub:authorized_runners` | Array JSON di alias autorizzati ad avviare la pipeline |

> **IMPORTANTE:** Il client Redis corretto usa `/pipeline` per SET e `/get/{key}` per GET. La doppia serializzazione è il bug più comune — verifica che tutti gli endpoint usino questa versione.

### 2.4 Struttura file (branch: `backend`)

```
hub.html                                          ← Frontend completo
api/hub/auth.js                                   ← GET verifica token
api/hub/upload.js                                 ← POST salva attività
api/hub/activities.js                             ← GET restituisce dati dashboard
api/hub/run.js                                    ← POST avvia GitHub Actions
api/hub/patch.js                                  ← POST riceve risultati pipeline
.github/workflows/hub-calibration.yml             ← Workflow GitHub Actions
wiztrail-calibration/scripts/01_prepare_dataset.py
wiztrail-calibration/scripts/02_compute_wdi.py
wiztrail-calibration/scripts/03_calibrate.py
wiztrail-calibration/scripts/04_insights.py
wiztrail-calibration/scripts/05_sync_hub.py
wiztrail-calibration/scripts/06_push_results.py
wiztrail-calibration/data/dataset.xlsx            ← 96 gare con metadati
wiztrail-calibration/gpx/                         ← GPX reali (47 file)
```

---

## 3. Token e accesso

### 3.1 Tipi di token

| Token | Uso | Gestito da |
|---|---|---|
| `HUB_SECRET_TOKEN` | URL utente `?key=TOKEN` | Admin WizTrail |
| `HUB_ADMIN_TOKEN` | URL admin `?key=TOKEN`, pipeline | Admin WizTrail |
| GitHub PAT | Vercel → triggera `repository_dispatch` | Admin WizTrail |
| `VERCEL_BYPASS_SECRET` | Pipeline → bypass Deployment Protection | Generato da Vercel |

### 3.2 Creare HUB_SECRET_TOKEN e HUB_ADMIN_TOKEN

Genera stringhe casuali:
```bash
openssl rand -base64 32
```

Dove configurarli: **Vercel → progetto → Settings → Environment Variables** → dopo ogni modifica fare Redeploy.

### 3.3 Creare il GitHub PAT

1. GitHub → profilo → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. "Generate new token (classic)"
3. Note: `WizTrail Hub Actions`, Expiration: No expiration
4. Scope: spunta **`repo`** (tutto) + **`workflow`**
5. Genera e copia il token
6. Vercel → Environment Variables → aggiungi `GITHUB_TOKEN`
7. GitHub → repo → Settings → Secrets → aggiungi `GITHUB_REPO = username/WizTrail`

> GitHub non permette secrets con nome che inizia con `GITHUB_` — per questo `GITHUB_TOKEN` viene configurato su Vercel, non come secret GitHub.

### 3.4 Vercel Bypass Secret

1. Vercel → progetto → Settings → Deployment Protection
2. Attiva **Protection Bypass for Automation**
3. Copia il valore generato (`VERCEL_AUTOMATION_BYPASS_SECRET`)
4. GitHub → repo → Settings → Secrets → aggiungi `VERCEL_BYPASS_SECRET`

### 3.5 GitHub Actions Secrets

Vai su GitHub → repo → Settings → Secrets and variables → Actions:

| Nome | Valore |
|---|---|
| `UPSTASH_REDIS_REST_URL` | URL REST Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Token REST Upstash |
| `HUB_ADMIN_TOKEN` | Identico a quello su Vercel |
| `VERCEL_HUB_URL` | URL base deployment (senza slash finale) |
| `VERCEL_BYPASS_SECRET` | Bypass secret generato da Vercel |
| `GITHUB_REPO` | `username/WizTrail` |

> **ATTENZIONE:** `HUB_ADMIN_TOKEN` nei secrets GitHub deve essere identico a quello su Vercel. Una discrepanza causa errore 401 durante l'invio dei risultati.

### 3.6 Abilitare write permissions per GitHub Actions

GitHub → repo → Settings → Actions → General → **Workflow permissions** → seleziona **Read and write permissions** → Save.

---

## 4. Guida Utente

### 4.1 Come ottenere l'accesso

L'admin ti fornisce un URL:
```
https://[deployment-url]/hub.html?key=TOKEN
```
Salvalo come preferito. Non va condiviso. Non è necessario un account.

### 4.2 Come caricare un'attività

1. Apri l'URL e scegli un **alias** (es. `michele`) — usalo sempre uguale
2. Seleziona il tipo: **Personale** (tuo allenamento) o **Riferimento** (gara nota)
3. Inserisci il nome dell'attività
4. Carica il file **GPX** (max ~5MB) — km e D+ vengono calcolati automaticamente
5. Verifica e correggi km e D+ se necessario
6. Inserisci il **tempo di completamento** (opzionale ma importante)
7. Valuta la **tecnicità** su scala 0-10 e seleziona l'etichetta
8. Aggiungi un commento opzionale
9. Clicca **Confermo e invio**

### 4.3 Scala tecnicità

| Valore | Etichetta | Descrizione |
|---|---|---|
| 0–3 | Corribile | Sentieri ampi, sterrato compatto |
| 3–5 | Misto | Alternanza sentiero/sterrato, qualche radice |
| 5–7 | Tecnico | Radici, rocce, attenzione continua |
| 7–8.5 | Alpino | Terreno instabile, passaggi su roccia, esposizione |
| 8.5–10 | Estremo | Via ferrata, ghiaccio, terreno non segnato |

### 4.4 Dashboard

Mostra: attività caricate, RMSE attuale (in punti, scala 0-100), grafico evoluzione, report calibrazione, pulsante download pacchetto zip.

---

## 5. Guida Admin

### 5.1 Accesso admin

```
https://[deployment-url]/hub.html?key=[HUB_ADMIN_TOKEN]
```

Aggiunge il tab **Admin** all'interfaccia.

### 5.2 Avviare la calibrazione

1. Verifica che ci siano attività con stato **pending** nel tab Dashboard
2. Tab Admin → clicca **Avvia calibrazione**
3. Monitora su GitHub → repo → tab **Actions**
4. La pipeline impiega ~3-5 minuti
5. Il banner "in corso" scompare automaticamente (polling ogni 10s)
6. Scarica il pacchetto zip → applica `4_wiztrail_patch.js`

### 5.3 Applicare la patch

**Blocco A** → `wiztrail-engine.js` → `buildTechScore()`:
- Aggiorna i 9 coefficienti (normFRIP, normSVar, normRough, vertInt, pesi raw)
- Non toccare `kT`, `DistFactor`, `WDI_THRESHOLDS`

**Blocco B** → `wiztrail-pacing.js` → `PACING_POWERLAW`:
- Aggiorna A, alpha, beta, c, pace10km_ref, delta
- Verifica il sanity check nel report prima di applicare

### 5.4 Aggiungere runner autorizzati

Tab Admin → sezione "Runner autorizzati" → inserisci alias → Aggiungi. L'utente vedrà il pulsante "Avvia calibrazione" nella sua dashboard.

### 5.5 Monitoraggio periodico

- Upstash → Data Browser → verifica che `hub:stats` non abbia campi `value` annidati
- GitHub Actions → verifica che l'ultimo workflow sia verde
- RMSE TechScore: se sale sopra 20 pts dopo calibrazione, investigare i dati recenti

---

## 6. Esempi di output reali

_Calibrazione del 20 aprile 2026 — 96 gare, 47 GPX reali._

### 6.1 Distribuzione WDI

| Classe | Gare | % |
|---|---|---|
| Sport (< 18) | 6 | 6.2% |
| Pro (< 40) | 23 | 24.0% |
| Advanced (< 80) | 38 | 39.6% |
| Extreme (< 140) | 15 | 15.6% |
| Elite (< 230) | 7 | 7.3% |
| Legend (≥ 230) | 6 | 6.2% |

### 6.2 Calibrazione TechScore

| Metrica | Prima | Dopo |
|---|---|---|
| RMSE TechScore (punti) | 32.99 | 13.51 |
| Miglioramento | — | +59.0% |
| GPX usati | — | 47 |

**Pesi calibrati v1.0:**

| Parametro | Calibrato | Precedente |
|---|---|---|
| normFRIP ref | 0.924 | 0.60 |
| normSVar ref | 0.180 | 0.55 |
| normRough ref | 0.051 | 0.35 |
| vertInt ref | 74.1 | 150 |
| w_frip | 0.244 | 0.45 |
| w_svar | 0.421 | 0.35 |
| w_rough | 0.208 | 0.20 |
| w_vert | 0.127 | 0.30 |

### 6.3 Modello tempi power-law v2.1

| Parametro | Valore |
|---|---|
| A | 0.00949 |
| alpha | 1.2231 |
| beta | 0.3288 |
| c | 0.6464 |
| pace10km_ref | 4.740 min/km (top 100 — da ricalibrale su avg_finish_hours) |
| delta | 0.3516 |
| RMSE 10-60km | 0.443h |

### 6.4 Benchmark WDI v5.1

| Gara | km | D+ | WDI | Classe |
|---|---|---|---|---|
| Sierre-Zinal | 31.2 | 2148m | 55.4 | Advanced |
| Zegama-Aizkorri | 42.4 | 3036m | 77.2 | Advanced (limite) |
| Speedgoat 50K | 50.5 | 3864m | 104.3 | Extreme |
| CCC | 98.8 | 6111m | 163.3 | Elite |
| UTMB | 174.5 | 10728m | 260.5 | Legend |
| Western States 100M | 161.0 | 6214m | 158.5 | Elite |

---

## 7. Soluzione problemi

### 7.1 Problemi utente

**"Maximum call stack size exceeded" durante upload GPX**
- Già fixato in hub.html (conversione base64 a chunk 8KB)
- Se si ripresenta: verificare presenza di `chunkSize = 8192` in hub.html

**Dashboard bloccata su "Caricamento"**
- Token non valido → verificare `?key=` nell'URL
- Errore 500 → aprire DevTools (F12) → tab Console per l'errore esatto
- `hub:stats` corrotto → vedi sezione 7.3

**WDI anteprima ≠ WDI dopo conferma**
- Già fixato: entrambe le formule sono allineate

### 7.2 Problemi admin

**"Pipeline in corso" con pulsante disabilitato**
1. Aspettare 5 min → appare pulsante "Reset flag in corso" → cliccare
2. Oppure: Upstash → `hub:stats` → imposta manualmente `pipeline_running: false`
3. Automatico: `run.js` resetta dopo 40 minuti

**Errore 401 allo step "Pubblica risultati"**
- `HUB_ADMIN_TOKEN` nei secrets GitHub ≠ quello su Vercel
- Soluzione: copiarli da Vercel → Environment Variables e aggiornare il secret GitHub

**Errore 403 allo step "Crea branch model-update"**
- GitHub → repo → Settings → Actions → General → Workflow permissions → Read and write

**"0 GPX" nella calibrazione TechScore**
- I GPX non sono in `wiztrail-calibration/gpx/` oppure i nomi non corrispondono ai `gpx_id` nel dataset

### 7.3 Problemi infrastrutturali

**hub:stats corrotto (doppia serializzazione)**

Sintomo: `{ "value": "{...}", "pipeline_running": null }`

Soluzione immediata — editare su Upstash:
```json
{"n_total":N,"n_pending":N,"last_run":null,"last_rmse":null,"pipeline_running":false}
```

Soluzione permanente: già implementata nel client Redis corretto (`/pipeline` per SET, `/get/{key}` per GET).

**Vercel restituisce pagina HTML di login**
- Attivare Protection Bypass → configurare `VERCEL_BYPASS_SECRET` nei secrets GitHub

**GitHub Actions non parte**
- PAT senza scope `workflow` → rigenerare con `repo` + `workflow`

**D+ calcolato molto inferiore al reale**
- Versione vecchia di `gpx-parser.js` (soglia 1m)
- Fix: smoothing adattivo + soglia 0m (già in produzione)

---

## 8. Variabili d'ambiente

### 8.1 Variabili Vercel

| Nome | Obbligatoria | Descrizione |
|---|---|---|
| `HUB_SECRET_TOKEN` | Sì | Token accesso utente |
| `HUB_ADMIN_TOKEN` | Sì | Token accesso admin — deve coincidere con secret GitHub |
| `GITHUB_TOKEN` | Sì | PAT GitHub con scope repo+workflow |
| `GITHUB_REPO` | Sì | `username/WizTrail` |
| `UPSTASH_REDIS_REST_URL` | Sì | URL REST Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Sì | Token REST Upstash |

### 8.2 Secrets GitHub Actions

| Nome | Obbligatoria | Descrizione |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Sì | Stesso valore di Vercel |
| `UPSTASH_REDIS_REST_TOKEN` | Sì | Stesso valore di Vercel |
| `HUB_ADMIN_TOKEN` | Sì | Identico a Vercel |
| `VERCEL_HUB_URL` | Sì | URL base deployment senza slash |
| `VERCEL_BYPASS_SECRET` | Sì | Generato da Vercel |
| `GITHUB_REPO` | Sì | `username/WizTrail` |

---

> **Dove salvare questo documento nella repo:**
> - `docs/hub-guide.md` — versione Markdown (questo file)
> - `docs/hub-guide.docx` — versione Word scaricabile
>
> Entrambi nel branch `backend`, cartella `docs/` da creare se non esiste.
