# WizTrail

**Trail running difficulty analysis and race time estimation.**

WizTrail calculates the **WDI (WizTrail Difficulty Index)** of any trail route, estimates a personalized finish time, and generates adaptive pacing plans — entirely in the browser, no server-side processing of GPS data.

🔗 **[wiztrail.app](https://ciao-madesign.github.io/WizTrail/)** *(custom domain pending)*

---

## What it does

| Feature | Description |
|---|---|
| **WDI v5.1** | Objective difficulty score from GPX data (distance, elevation, terrain variability) |
| **Time estimation** | Segment-based model (`wiztrail-timing.js`), calibrated on 47 real GPX — shared between Calculator and Training Analyzer |
| **Adaptive pacing** | Chunk-based pacing plan segmented by terrain difficulty |
| **Training Analyzer** | Analyze Strava activities with TrainingScore layer |
| **Post-race report** | Compare predicted vs actual performance |
| **Ranking** | Curated ranking of trail/sky races by WDI |
| **PWA** | Installable, works offline |

---

## Architecture

```
Browser (client-side calculation)
├── wiztrail-engine.js      — WDI v5.1 unified engine
├── wiztrail-timing.js      — segment-based time model (shared: Calculator + Training Analyzer)
├── wiztrail-pacing.js      — pacing planner (chunk-based distribution of T_target)
├── gpx-parser.js           — GPX/TCX parser, adaptive smoothing
├── discipline-classifier.js — trail/sky/mountain/XC auto-classification
├── map.js                  — Leaflet map + elevation profile
├── ui.js                   — DOM updates, KPI rendering
└── main.js                 — orchestration, event handling

Vercel serverless (OAuth + hub only)
├── api/strava/
│   ├── callback.js         — OAuth2 token exchange
│   ├── activities.js       — fetch activity list
│   └── activity.js         — fetch + analyze single activity
├── api/hub/
│   ├── auth.js             — hub admin authentication
│   ├── upload.js           — GPX + metadata upload
│   ├── activities.js       — list hub activities
│   ├── run.js              — trigger calibration pipeline
│   └── patch.js            — retrieve calibration results
└── api/lib/
    └── ratelimit.js        — Upstash Redis sliding window (30 req/min/IP)

Calibration pipeline (GitHub Actions + Python 3.11)
wiztrail-calibration/
├── data/dataset.xlsx       — 96 races with metadata
├── gpx/                    — real GPX traces (47 files)
└── scripts/
    ├── 01_prepare_dataset.py
    ├── 02_compute_wdi.py
    ├── 03_calibrate.py     — differential_evolution optimizer
    ├── 04_insights.py
    ├── 05_sync_hub.py
    └── 06_push_results.py
```

**Key design principles:**
- All GPX processing and scoring happens **client-side** — no GPS data is ever sent to a server
- Serverless functions handle OAuth and the calibration hub only
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
| PWA | Service Worker + Web App Manifest |

---

## Environment Variables (Vercel)

```
STRAVA_CLIENT_ID      — Strava app client ID
STRAVA_CLIENT_SECRET  — Strava app client secret
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
HUB_ADMIN_SECRET      — hub authentication key
```

⚠️ Never commit these to the repository.

---

## Calibration Hub

The hub allows continuous model improvement via real user data:

1. User uploads a GPX with finish time and technicality rating
2. Data is stored in Upstash Redis
3. Admin triggers the calibration pipeline via GitHub Actions
4. Pipeline re-optimizes TechScore weights and VELOCITY_PARAMS (segment-based time model)
5. Results are published as a patch for manual review and application

```bash
# Trigger manually
gh workflow run hub-calibration.yml
```

Documentation: [docs/hub-guide.md](docs/hub-guide.md)

---

## Roadmap

| Status | Milestone |
|---|---|
| ✅ | M0 — Strava security (serverless callback, env vars) |
| ✅ | M1 — Codebase refactor (modular JS) |
| ✅ | M2 — Rate limiting (Upstash Redis) |
| 🟡 | M3 — Algorithm + UX (WDI v5.1 ✅, hub ✅, UX in progress) |
| 🔵 | M5 — Public API (`/api/v1/wdi`, `/api/v1/pacing`) |
| 🔵 | M6 — Android (Capacitor) |
| ⏸️ | M4 — Auth (HTTP-only cookies, deferred) |

---

## Project Structure

```
WizTrail/
├── landing.html              # Entry point — marketing page
├── index.html                # App — calculator
├── about.html                # Methodology, algorithm, architecture
├── ranking.html              # Race ranking by WDI
├── training-analyzer.html    # Strava training analysis
├── dettaglio.html            # Post-race detail page
├── install.html              # PWA install guide
├── share_card.html           # Shareable result card
├── wiztrail-engine.js        # WDI engine v5.1
├── wiztrail-timing.js        # Segment-based time model v3.0 (shared)
├── wiztrail-pacing.js        # Pacing planner (chunk-based)
├── gpx-parser.js             # GPX/TCX parser
├── discipline-classifier.js  # Discipline auto-classification
├── map.js                    # Map + elevation profile
├── ui.js                     # DOM rendering
├── main.js                   # Entry point + orchestration
├── wiztrail.css              # Global styles
├── service-worker.js         # PWA cache (network-first for HTML/CSS/JS)
├── manifest.webmanifest
├── api/                      # Vercel serverless functions
├── wiztrail-calibration/     # Dataset + GPX + Python scripts
├── docs/                     # Hub guide
└── .github/workflows/        # GitHub Actions (calibration pipeline)
```

---

## License

WizTrail WDI algorithm — proprietary, all rights reserved.
Third-party libraries — see [about.html#licenze](about.html#licenze).
