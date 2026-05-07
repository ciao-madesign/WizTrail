# WizTrail Design System v1.1

> Visual + UX guidelines and component library for **WizTrail** — a browser-based trail running analysis web app that reads GPX files and returns the **WDI (WizTrail Difficulty Index)**, a personalized finish-time estimate, and adaptive pacing plans.

---

## What is WizTrail

WizTrail is a PWA (no native app) that helps runners understand *how hard* a trail route actually is. Everything runs client-side: no GPS data is ever uploaded. The product exposes:

| Surface | Role |
|---|---|
| **Landing** (`landing.html`) | Marketing page — hero photo + features + WDI ladder + privacy pitch |
| **Calculator** (`index.html`) | Core app — GPX dropzone, athlete params, WDI + estimated-time KPIs, tabs for Pacing / Map2D / Feedback |
| **Ranking** (`ranking.html`) | Curated table of 96+ real races sorted by WDI |
| **Training Analyzer** (`training-analyzer.html`) | Training load analysis (WDI + TechScore per session) |
| **About** (`about.html`) | Methodology, formula, licensing |
| **Pacing** (`pacing.html`) | Pacing Planner model documentation |
| **WDI** (`wdi.html`) | WDI white paper |

Only **one** product in the traditional sense — a web app + marketing site, unified by the same visual language.

---

## Index — what's in this folder

| Path | Purpose |
|---|---|
| `README.md` | This file — full guide: sources, content, visual, iconography |
| `SKILL.md` | Cross-compatible Agent Skill manifest (for Claude Code export) |
| `colors_and_type.css` | All CSS variables (colors, type, spacing, radii) + `.wt-*` semantic utility classes |
| `assets/` | `logo.svg`, `logo-mark.svg`, `topo_texture.png`, PWA icons |
| `preview/` | Design-system cards (registered in the Design System tab) |
| `ui_kits/web/` | React UI kit — landing + calculator click-thru prototype |

---

## Sources used to build this system

| Source | Link / path |
|---|---|
| Live site | <https://wiz-trail.vercel.app> |
| GitHub repo | [`ciao-madesign/WizTrail`](https://github.com/ciao-madesign/WizTrail) (branch: `backend`) |
| Global stylesheet | `wiztrail.css` — source of truth for tokens, components, microinteractions |
| Design tokens | `colors_and_type.css` — all CSS custom properties |
| Landing page | `landing.html` — hero + features + WDI showcase |
| App shell | `index.html` + `wiztrail.css` — calculator, KPIs, tabs, dropzone, pacing table |

---

## Content fundamentals

### Language
- **Primary language: Italian.** Every user-facing surface is in Italian. English appears only for technical acronyms: *WDI, TechScore, TrainingScore, PWA, RMSE, GPX, KPI*.
- English in a component is a *flag* that it's a technical term, not a translation.

### Tone
- **Direct, technical without jargon.** Sentences are short, factual, low on adjectives. The product leans into competence, not hype.
- **"Tool, not a fitness app."** There is **no** gamification, no streaks, no motivational language, no emoji in UI. Values are shown, not celebrated.
- **"Tu" form** (informal singular), but kept minimal — copy prefers imperatives + object statements ("Carica il GPX", "Analizza il tuo trail").
- **Zero marketing bluster.** Even the hero subtitle is a factual statement, not a promise.

### Casing
- **Sentence case** for body and section titles.
- **ALL CAPS + wide tracking (0.10em)** *only* for CTAs, eyebrows, and metric labels: `ANALIZZA GPX`, `TEMPO STIMATO`, `GARE CALIBRATE`.
- **Title case** never used.

### Voice examples (lifted from the product)
| Where | Copy |
|---|---|
| Landing hero | "WDI, TechScore, Pacing. Dal GPX al piano di gara." |
| Landing sub | "Carica il file GPX del tuo percorso e ottieni WDI, stima del tempo e pacing adattivo. Tutto in locale — nessun account, nessun upload." |
| Dropzone | "Trascina il GPX qui o clicca per selezionare" |
| Primary CTA | "ANALIZZA GPX" |
| Secondary CTA | "COME FUNZIONA" |
| Privacy block | "Il tuo GPX rimane sul tuo dispositivo." |

### Emoji
- **Banned from UI.** No emoji in buttons, labels, nav, KPI rows, or result output.
- May appear in documentation/marketing text outside the UI chrome only.

### Data presentation
- **Numbers are big, tabular, and neutral.** `WDI 55.4`, `7h 42m`, `+12%`.
- **Units** are a smaller dim label: `TEMPO STIMATO` above the value, `ADVANCED` below.
- **Deltas** are signed: `+7%`, `−12%`.

---

## Visual foundations (DS v1.1)

### Color
- **Base palette is deep off-black** — `#111111` (page bg) and `#1C1C1C` (cards). Pure off-black, no blue tint.
- **One accent: lime `#B8D400`** with `#8FA000` for hover states. Used for: primary CTAs, active scores, critical data values, focus rings.
- **Functional-only color usage.** A screen usually has exactly two color events — the ink-on-dark body, and one lime touch where the user's eye should land.
- **WDI difficulty scale** (data palette, ONLY for WDI classification):
  - Sport `#4E7C59` · Pro `#A8B94F` · Advanced `#D4A843` · Extreme `#C06030` · Elite `#8B2020` · Legend `#C8C8C8`
- **No glass/blur effects.** Cards are solid `#1C1C1C`, not translucent. No `backdrop-filter`.
- **Light theme is secondary.** Dark is the default and production surface.

### Typography
- **Three families: Inter (UI) + Neue Haas Grotesk→Inter (display) + JetBrains Mono (data).**
- **Fonts loaded via `<link>` in HTML `<head>`.** Never via `@import` in CSS.
- **Inter 700 is the display weight.** Headings use 600–700 with tight tracking (−0.01em).
- Labels, eyebrows, CTAs: Inter 500–700, ALL CAPS, 0.10em tracking.
- **JetBrains Mono is ONLY for data**: pace `mm:ss`, WDI values, time deltas, coordinates. Weight 400/500.
- **No italic emphasis** in titles (removed in DS v1.1).

### Spacing
- 4-based scale (`4, 8, 12, 16, 24, 32, 48, 64, 96px`).
- Sections are **generous** — landing sections use 96px top/bottom padding.
- Inputs are **compact** — data-density in the calculator is high.

### Backgrounds
- **No gradients on app pages.** Background is flat `#111111`.
- **Landing uses a full-bleed dark mountain photo** as hero. Image filtered to `brightness(0.4) saturate(0.7)`.
- **Topo-line texture** (`img/topo-pattern-on-dark.svg`) applied as `::before` overlay on all `.card` and key off-black surfaces at 6–9% opacity.

### Topo pattern — implementation
```css
.card {
  position: relative;
  overflow: hidden;
  isolation: isolate;
}
.card::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: url('/img/topo-pattern-on-dark.svg');
  background-size: 480px;
  opacity: 0.06;
  pointer-events: none;
  z-index: -1;
}
```

### Corner radii
- DS v1.1 uses **sharp geometry**, max 4px.
- `--r-0: 0` — flat, hairline borders only
- `--r-1: 2px` — cards, buttons, inputs
- `--r-2: 4px` — tags, chips, small accents
- **No** 10px+ radius anywhere.

### Cards
- **`.card`** — `#1C1C1C` background, `1px solid #2E2E2E` border, `2px` radius, topo `::before` at 6% opacity.
- **`.kpi-primary`** — same but topo at 9% opacity. Used for WDI and estimated-time hero KPIs.

### Borders
- `1px solid #2E2E2E` for cards and inputs.
- `1.5px dashed` lime-at-40% for dropzones; goes solid on load.

### Animations & motion
- **Slow, settled.** Tokens: `--dur-fast: 150ms`, `--dur-base: 250ms`, `--dur-slow: 350ms`.
- Default easing: `cubic-bezier(0.25, 0.46, 0.45, 0.94)`.
- Page loads fade + `translateY(6px)` up over 350ms.
- No bounce, no spring (removed in DS v1.1).

### Layout rules
- **Fixed header, transparent.** 56px tall.
- **Max content width is 1100px**, centered.
- **Two-column grids at 900px** — collapse to single below.

---

## Iconography

WizTrail has **no dedicated icon font**. Icons come from:

1. **Inline SVG, hand-crafted, 24×24, stroke-based.** `stroke-width: 1.5`, `stroke-linecap: round`, `stroke-linejoin: round`, `fill: none`, `stroke: currentColor`. Feather/Lucide aesthetic.
2. **Lucide icons** as de-facto standard for prototypes — matches the existing hand-SVG stroke style.

**Logo assets available:**
- `assets/logo.svg` — full WizTrail logo
- `assets/logo-mark.svg` — minimal glyph version
- `assets/logo-192.png`, `assets/logo-592.png` — PWA icons

**Do not:**
- Use filled/material icons — strictly stroke-based.
- Use colored icons — icons inherit `currentColor`.

---

## Font substitution

Fonts loaded from Google Fonts via `<link>` tags in each HTML page `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap">
```

**If offline/embeddable outputs are needed**, self-host `.woff2` for:
- Inter — weights 400, 500, 600, 700
- JetBrains Mono — weights 400, 500, 600

---

## Caveats

- Light theme is preserved as CSS tokens but ships dark by default.
- Hero photography is **not** included in assets — use placeholder + topo texture for prototypes.
- The WDI palette (5 colors) is for data classification only — never for general UI accents.
