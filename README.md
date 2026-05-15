# WizTrail

**Trail running difficulty analysis and race time estimation.**

WizTrail calculates the **WDI (WizTrail Difficulty Index)** of any trail route, estimates a personalized finish time, and generates adaptive pacing plans — entirely in the browser, no server-side processing of GPS data.

🔗 **[wiz-trail.vercel.app](https://wiz-trail.vercel.app)** *(custom domain pending)*

---

## What it does

| Feature | Description |
|---|---|
| **WDI v5.1** | Objective difficulty score from GPX data (distance, elevation, terrain variability) |
| **Time estimation** | Segment-based model (`wiztrail-timing.js`), calibrated on 96 real races |
| **Adaptive pacing** | Chunk-based pacing plan segmented by terrain difficulty |
| **Training Analyzer** | Analyze Strava activities with TrainingScore layer |
| **Post-race report** | Compare predicted vs actual performance |
| **Ranking** | Curated ranking of 31 trail/mountain/ultra races by WDI, with discipline auto-classification |
| **GPX URL import** | Load a GPX directly from a URL via SSRF-protected proxy |
| **PWA** | Installable, maskable icon, works offline |

---

## Architecture

```
Browser (client-side calculation)
├── wiztrail-engine.js       — WDI v5.1 unified engine
├── wiztrail-timing.js       — segment-based time model (shared: Calculator + Analyzer)
├── wiztrail-pacing.js       — pacing planner (chunk-based distribution of T_target)
├── gpx-parser.js            — GPX/TCX parser, adaptive smoothing, max_altitude extraction
├── discipline-classifier.js — trail/sky/mountain/ultra/xc auto-classification (31/31 accuracy)
├── map.js                   — Leaflet map + elevation profile
├── ui.js                    — DOM updates, KPI rendering
└── main.js                  — orchestration, event handling

Vercel serverless (11/12 functions — Hobby plan limit)
├── api/strava/
│   ├── callback.js          — OAuth2 token exchange
│   ├── activities.js        — fetch activity list
│   └── activity.js          — fetch + analyze single activity
├── api/hub/
│   ├── auth.js              — hub admin authentication
│   ├── upload.js            — GPX + metadata upload
│   ├── activities.js        — list hub activities
│   ├── run.js               — trigger calibration pipeline
│   ├── patch.js             — retrieve calibration results
│   └── feedback.js          — post-race feedback (CSRF-protected, per-origin CORS)
├── api/import/
│   └── url.js               — GPX proxy fetch (SSRF-protected: blocks private IPs, metadata endpoints)
└── api/lib/
    └── ratelimit.js         — Upstash Redis sliding window (30 req/min/IP)

Calibration pipeline (GitHub Actions + Python 3.11)
wiztrail-calibration/
├── data/dataset.xlsx        — 96 races with metadata
├── gpx/                     — 81 real GPX traces
└── scripts/
    ├── 01_prepare_dataset.py
    ├── 02_compute_wdi.py
    ├── 03_calibrate.py      — differential_evolution optimizer
    ├── 04_insights.py
    ├── 05_sync_hub.py       — sync hub submissions from Redis
    ├── 06_push_results.py   — publish results to Redis + Vercel
    └── 07_apply_patch.py    — apply calibration patch to engine files
```

**Key design principles:**
- All GPX processing and scoring happens **client-side** — no GPS data is ever sent to a server
- Serverless functions handle OAuth, calibration hub, and URL proxy only
- The model improves automatically as more real GPX data is added via the hub

---

## WDI — WizTrail Difficulty Index v5.1

```
WDI = (VolumeScore + TechScore × kT) × DistFactor × AltFactor

kT = 0.50   (calibrated 2026-04-20)
DistFactor exponent = 0.48  (sublinear scaling for ultras)
```

**Classes (thresholds v2, synchronized across engine + map.js + about.html):**

| Class | WDI | Example |
|---|---|---|
| Sport | < 18 | Local trail 15km |
| Pro | 18–40 | Valtellina Wine Trail 42K |
| Advanced | 40–80 | Sierre-Zinal 31K (55.4) |
| Extreme | 80–140 | Speedgoat 50K (104.3) |
| Elite | 140–230 | CCC 99K (163.3) |
| Legend | ≥ 230 | UTMB 174K (260.5) |

TechScore (0–100) is calibrated from real GPX data using differential_evolution on 9 weights (FRIP, SlopeVar, Roughness, vertical intensity). Current RMSE: **13.51 pts (−59% from baseline)**.

Full methodology: [about.html](about.html)

---

## Discipline Classifier

Auto-classifies a race into `trail | sky | mountain | ultra | xc` from GPX metrics.

```
ULTRA    → distance ≥ 95 km
SKY      → max_altitude > 2000 m AND D+/km > 100
MOUNTAIN → D+/km > 80 AND max_altitude > 1200 m
XC       → distance ≤ 12 km AND D+ < 200 m
TRAIL    → default
```

`max_altitude` is extracted from GPX at parse time and stored in `ranking-data.json` for the 31 ranked races. Accuracy on current dataset: **31/31**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — no framework |
| Hosting | Vercel (static + serverless Node.js ES Module) |
| Rate limiting | Upstash Redis (REST API, sliding window) |
| Auth | Strava OAuth2 — `client_secret` server-side only |
| Calibration | Python 3.11, scipy, openpyxl — GitHub Actions |
| Maps | Leaflet 1.9.4 + CartoDB tiles |
| Font | DM Mono (Google Fonts) + Georgia (system) |
| PWA | Service Worker + Web App Manifest + maskable icon |

---

## Security

- **CSRF**: `api/hub/feedback.js` uses per-origin CORS (`Vary: Origin`) and blocks requests from unauthorized origins with HTTP 403. Allowed: `wiz-trail.vercel.app`, `ciao-madesign.github.io`, `*.vercel.app` (preview deploys).
- **SSRF**: `api/import/url.js` blocks requests to private IP ranges (`127.x`, `10.x`, `192.168.x`, `172.16–31.x`, `169.254.x` AWS/GCP metadata, `::1`, `fe80:`, `fd*`). Only `http`/`https` allowed, max 5 MB, content-type validated.
- **CI push**: calibration bot uses `--force-with-lease` (not `--force`) to prevent overwriting concurrent remote commits.

---

## Environment Variables (Vercel)

```
STRAVA_CLIENT_ID         — Strava app client ID
STRAVA_CLIENT_SECRET     — Strava app client secret
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
HUB_ADMIN_TOKEN          — hub admin authentication key
HUB_SECRET_TOKEN         — hub internal secret
VERCEL_HUB_URL           — Vercel deployment URL (used by CI pipeline)
VERCEL_BYPASS_SECRET     — Vercel protection bypass for CI
```

⚠️ Never commit these to the repository.

---

## Calibration Hub

The hub allows continuous model improvement via real user data:

1. User uploads a GPX with finish time via `hub.html`
2. Data is stored in Upstash Redis
3. Admin triggers the calibration pipeline via GitHub Actions (`hub-calibration.yml`)
4. Pipeline (`01`→`07`) re-optimizes TechScore weights and VELOCITY_PARAMS, applies the patch to `wiztrail-engine.js` and `wiztrail-timing.js`, and opens a `model-update` branch
5. Branch is reviewed and merged manually

```bash
# Trigger manually via GitHub CLI
gh workflow run hub-calibration.yml
```

Documentation: [docs/hub-guide.md](docs/hub-guide.md)

---

## Roadmap

| Status | Item |
|---|---|
| ✅ | Strava OAuth2 — serverless callback, env vars |
| ✅ | Codebase refactor — modular JS, shared timing model |
| ✅ | Rate limiting — Upstash Redis sliding window |
| ✅ | Calibration hub — upload, pipeline, model-update branch |
| ✅ | WDI v5.1 — kT=0.50, EXP=0.48, calibrated on 96 races |
| ✅ | UX/copy audit — style guide, microcopy, surface slider removed |
| ✅ | Security hardening — CSRF, SSRF, CI `--force-with-lease` |
| ✅ | PWA — maskable icon, offline cache |
| ✅ | Discipline classifier DC5 — Phase 1 (31/31 accuracy, max_altitude from GPX) |
| 🔵 | Discipline classifier DC5 — Phase 2 (sky/xc examples, threshold validation) |
| 🔵 | EN/IT localizzazione |
| 🔵 | Custom domain |
| ⏸️ | Public API (`/api/v1/wdi`, `/api/v1/pacing`) — Vercel Pro required |
| ⏸️ | Suunto OAuth2, M5-CERT API — Vercel Pro required |
| ⏸️ | Android (Capacitor) |

---

## Project Structure

```
WizTrail/
├── landing.html              # Entry point — marketing page
├── index.html                # App — calculator
├── about.html                # Methodology, algorithm, architecture
├── ranking.html              # Race ranking by WDI + discipline
├── training-analyzer.html    # Strava training analysis
├── dettaglio.html            # Post-race detail page
├── hub.html                  # Calibration hub (admin)
├── install.html              # PWA install guide
├── share_card.html           # Shareable result card
├── wiztrail-engine.js        # WDI engine v5.1
├── wiztrail-timing.js        # Segment-based time model v3.0 (shared)
├── wiztrail-pacing.js        # Pacing planner (chunk-based)
├── gpx-parser.js             # GPX/TCX parser + max_altitude extraction
├── discipline-classifier.js  # Discipline auto-classification
├── map.js                    # Map + elevation profile
├── ui.js                     # DOM rendering
├── main.js                   # Entry point + orchestration
├── ranking-data.json         # 31 ranked races (with max_altitude)
├── wiztrail.css              # Global styles
├── service-worker.js         # PWA cache (network-first for HTML/CSS/JS)
├── manifest.webmanifest      # PWA manifest (any + maskable icons)
├── icons/                    # icon-192.png, icon-512.png, icon-maskable.svg
├── api/                      # Vercel serverless functions (11/12)
├── wiztrail-calibration/     # Dataset (96 races) + 81 GPX + Python scripts
├── docs/                     # Hub guide, API docs, contributing
└── .github/workflows/        # hub-calibration.yml (GitHub Actions)
```

---

## License

WizTrail WDI algorithm — proprietary, all rights reserved.
Third-party libraries — see [about.html#licenze](about.html#licenze).
