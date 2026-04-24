# WizTrail Design System

> Visual + UX guidelines and component library for **WizTrail** — a browser-based trail running analysis web app that reads GPX files and returns the **WDI (WizTrail Difficulty Index)**, a personalized finish-time estimate, and adaptive pacing plans.

---

## What is WizTrail

WizTrail is a PWA (no native app) that helps runners understand *how hard* a trail route actually is. Everything runs client-side: no GPS data is ever uploaded. The product exposes:

| Surface | Role |
|---|---|
| **Landing** (`landing.html`) | Marketing page — hero photo + features + WDI ladder + privacy pitch |
| **Calculator** (`index.html`) | Core app — GPX dropzone, athlete params, WDI + estimated-time KPIs, tabs for Pacing / Map2D / Feedback |
| **Ranking** (`ranking.html`) | Curated table of real races sorted by WDI |
| **Training Analyzer** (`training-analyzer.html`) | Strava-connected analysis of workouts |
| **About** (`about.html`) | Methodology, formula, licensing |
| **Share Card** (`share_card.html`) | Exportable image of the result |

Only **one** product in the traditional sense — a web app + marketing site, unified by the same visual language.

---

## Index — what's in this folder

| Path | Purpose |
|---|---|
| `README.md` | This file — full guide: sources, content, visual, iconography |
| `SKILL.md` | Cross-compatible Agent Skill manifest (for Claude Code export) |
| `colors_and_type.css` | All CSS variables (colors, type, spacing, radii, shadows) + `@font-face` |
| `fonts/` | Outfit, Inter, DM Mono (variable TTFs from Google Fonts) |
| `assets/` | `logo.svg`, `mark.svg`, `topo_texture.png`, hero photos, WDI class dots |
| `preview/` | Design-system cards (registered in the Design System tab) |
| `ui_kits/web/` | React UI kit — landing + calculator click-thru prototype |

### UI kits
- `ui_kits/web/` — landing page + calculator app (both surfaces in one index.html with nav)

---

## Sources used to build this system

| Source | Link / path |
|---|---|
| Live site | <https://ciao-madesign.github.io/WizTrail/> |
| GitHub repo | [`ciao-madesign/WizTrail`](https://github.com/ciao-madesign/WizTrail) (branch: `backend`) |
| Global stylesheet | `wiztrail.css` (~35 KB) — source of truth for tokens, glass panels, microinteractions |
| Landing page | `landing.html` — hero + features + WDI showcase; origin of display type treatment |
| App shell | `index.html` + `wiztrail.css` — calculator, KPIs, tabs, dropzone, pacing table |
| Logo | `img/logo.svg`, `icons/logo-192.png` (imported to `assets/`) |
| Topo texture | `img/topo_texture.png` (imported to `assets/`) |

Nothing is assumed — read the README inside this project; every claim maps back to code.

---

## Content fundamentals

### Language
- **Primary language: Italian.** Every user-facing surface is in Italian ("Analizza il tuo trail", "Carica il GPX", "Il Metodo"). English appears only for technical acronyms: *WDI, TechScore, TrainingScore, PWA, RMSE, GPX, KPI*.
- English in a component is a *flag* that it's a technical term, not a translation.

### Tone
- **Direct, technical without jargon.** Sentences are short, factual, low on adjectives. The product leans into competence, not hype.
- **No "fitness-app" energy.** There is **no** gamification, no streaks, no "level up!", no emoji cheerleading. Values are shown, not celebrated.
- **"Tu" form** (informal singular), but kept minimal — copy prefers imperatives + object statements ("Carica il GPX", "Analizza il tuo trail").
- **Zero marketing bluster.** Even the hero subtitle is a factual statement, not a promise.

### Casing
- **Sentence case** for UI labels, buttons, section titles: `Calcolatore`, `Parametri atleta`, `Scarica KML`, `Il Metodo`.
- **ALL CAPS + wide tracking** *only* for eyebrows and metric labels above KPIs: `WIZTRAIL — DIFFICULTY INDEX V5.1`, `GARE CALIBRATE`.
- **Title case** never used — it reads as American and breaks the tone.

### Voice examples (lifted from the product)
| Where | Copy |
|---|---|
| Landing eyebrow | `WIZTRAIL — DIFFICULTY INDEX V5.1` |
| Landing hero | "Ogni salita ha un *peso preciso*." |
| Landing subhead | "Carica il GPX, calcola il WDI del tuo percorso e ottieni la stima di tempo calibrata sul tuo livello. Tutto in locale, nessun account richiesto." |
| Dropzone | "Trascina il GPX qui o clicca per selezionare" |
| Dropzone sub | "GPX · TCX · XML — Garmin, Suunto, Wikiloc, Komoot" |
| KPI placeholder | "Inserisci t10km e premi Calcola" |
| Privacy block title | "Il tuo GPX rimane *sul tuo dispositivo*." |
| CTA | "Analizza il tuo trail →" |

### Italics for emphasis
A distinctive move: **italicized teal phrase** inside a light-weight title. Used exactly once per title, on the noun phrase that carries the promise.
> Ogni salita ha un *peso preciso*.
> Sei classi di difficoltà, *calibrate su dati reali*.

### Emoji
- **Restrained.** Used sparingly as functional icons inside privacy/feature cards (🔒 📵 📱 ⛰️ ⏱️ 📊 🗺️ 🏃 📋). **Not** used in running body copy, KPI rows, or marketing titles.
- When a dedicated icon system exists (see ICONOGRAPHY), prefer line SVGs; emoji is a fallback.

### Data presentation
- **Numbers are big, tabular, and neutral.** `WDI 55.4`, `02:45:00`, `+12%`.
- **Units** are a smaller dim pill next to the value: `WDI 55.4 ADVANCED`, never "WDI: Advanced — 55.4!".
- **Deltas** are signed: `+7%`, `−12%` (Unicode minus, not hyphen, where typography allows).

---

## Visual foundations

### Color
- **Base palette is deep inky near-black** (`#0a0f14`) with a hint of blue — never pure black. Cards sit on top as `#121a22`, inputs as `#0f151c`. This gives the UI a cool, calm mountain-dusk feeling.
- **One accent: teal `#4fd1c5`** (with `#81e6d9` for hover and `#002b2b` as on-teal text anchor). Used for: primary CTAs, focus rings, eyebrows, KPI primary border tint, italic emphasis in titles, active tab background.
- **Functional-only color usage.** A screen usually has exactly two color events — the ink-on-dark body, and one teal touch where the user's eye should land. Nothing decorative.
- **WDI difficulty scale** (data palette, not brand): Sport `#2BB7DA` → Pro `#34A853` → Advanced `#F4C20D` → Extreme `#F79617` → Elite `#E91E63` → Legend `#8E24AA`. These are *only* for WDI classification, never for general UI.
- **Light theme exists** but is secondary. Teal shifts to sky blue (`#0ea5e9`) for contrast.

### Typography
- **Two families: Outfit (sans) + DM Mono.** Both on Google Fonts — substitution flagged below.
- **Outfit 300 (Light) is the brand voice.** `h1`/`h2` are `font-weight: 300` with `letter-spacing: -0.3px`. This quiet elegance is the single most important typographic move — it makes a technical app feel editorial.
- Labels, buttons, nav: Outfit 600–700.
- KPI numbers: Outfit 900 — heavy contrast with the light headings.
- Mono is **only** for data (pace `mm:ss`, WDI values in some tables, coordinates, time deltas).
- Italics in titles are always teal + always on the noun phrase (see Content Fundamentals).

### Spacing
- 4-based scale (`4, 8, 12, 16, 24, 32, 48, 64, 96px`).
- Sections are **generous** — landing sections use 100px top/bottom padding; the `.wrap` page container uses `74px` top offset to clear the fixed header + `18px` bottom.
- Inputs are **compact** (`8px × 10px` padding, `14px` font) — data-density in the calculator is high, but surrounded by whitespace.
- Minimum tap target on mobile is 44px (enforced via `min-height: 44px` on `.btn` and inputs under 600px).

### Backgrounds
- **No photos on app pages.** The global background is **two radial gradients** (teal top-right, sky blue bottom-left, both very faint) layered under a 45–75% dark overlay. That's it. Never a photographic hero on the app.
- **Landing is the exception** — it uses a full-bleed dark mountain photo with a deep vignette gradient. Image is set to `brightness(0.42) saturate(0.75)` so it never competes with the foreground.
- **Topo-line texture** (`assets/topo_texture.png`) is available as a subtle decorative layer — use at 3–6% opacity on dark panels when you need motif without noise. Never at full opacity.
- No gradients on buttons, cards, or text. Gradients are strictly for ambient background + hero overlays.

### Glass surfaces (signature treatment)
- Cards, fieldsets, and the main `.wrap` container use **`color-mix` transparency + backdrop-filter blur**: `background: color-mix(in oklab, var(--card) 68%, transparent); backdrop-filter: blur(12px) saturate(130%)`.
- The effect is subtle — not frosted, not "Big Sur glass". Just enough to make the ambient gradient bleed through edges.
- Mobile uses smaller blur radii (`blur(12px)` vs `blur(16px)` desktop) for performance.

### Animations & motion
- **Slow, settled, never bouncy by default.** Centralized tokens: `--dur-fast: 150ms` (hover), `--dur-base: 250ms` (panels), `--dur-slow: 350ms` (page-in).
- Default easing is a gentle `cubic-bezier(0.25, 0.46, 0.45, 0.94)` out-curve.
- **Spring** (`cubic-bezier(0.34, 1.2, 0.64, 1)`) is reserved for **KPI reveals** after a calculation — the one moment where the UI should feel happy.
- Page loads **fade+translateY(6px)** up over 350ms.
- Hero image scale from 1.05 → 1.0 over 8s on load (very slow, cinematic).
- Tab switches fade over 150ms — tabs don't slide.

### Hover / press states
- **Hover on buttons**: lighter teal (`#81e6d9`), `translateY(-1px)` on primaries. No scale, no shadow change.
- **Press / active**: `transform: scale(0.97)`, 80ms. Tactile but not cartoony.
- **Link hover**: teal or opacity `.88`.
- **Card/row hover**: background shifts 4–8% more opaque; border-color to a teal tint.
- **Focus (input)**: `border-color: teal` + `box-shadow: 0 0 0 3px teal@20%`. Never a browser-default outline.

### Borders
- Hairline borders using `color-mix(in oklab, var(--border) 70%, transparent)`.
- Data-table rows use borders at 40% of `--border` — even quieter.
- Dropzones use a **1.5px dashed teal-at-40%** border that goes solid when loaded.
- No heavy 2px+ borders anywhere outside dropzones.

### Shadows
- **One soft card shadow:** `0 8px 28px rgba(0,0,0,.18)` + an inner hairline `0 1px 0 rgba(255,255,255,.04)` to lift from the dark surface.
- Hover adds shadow (`0 10px 24px rgba(0,0,0,.25)`) + a slight lift.
- Floating banners use `0 6px 16px rgba(0,0,0,.15)`.
- No colored shadows, no glow effects, no drop-shadow on text.

### Transparency & blur usage
- Glass is used on **elevated surfaces** (cards, fieldsets, the main wrap) — never on text or icons.
- Header uses `blur(4px)` — just enough to hold legibility when scrolled over imagery.
- Modal overlays: `rgba(0,0,0,0.75)` + `blur(4px)`.

### Corner radii
- Inputs, buttons, tabs: **10px** (`--wt-r-md`).
- Cards, KPIs, fieldsets: **12px** (`--wt-r-lg`).
- Main page wrap, modal: **16px** (`--wt-r-xl`).
- Pills, tags, small accents: **4–6px** (`--wt-r-xs`/`sm`).
- No fully rounded pills (no 999px) except legend dots and internal chip accents.

### Cards
Two card types, both glass:
- **`.kpi`** — dark panel with hairline border. Title in 0.95rem semibold + big value.
- **`.kpi-primary`** — same, but tinted with 6% teal bg and 20%-teal border. Used for the two hero KPIs (WDI, estimated time). Paired on screen, never solo.

### Layout rules
- **Fixed header, transparent.** 56px tall, full-width gradient from 82% ink at top → transparent at 80px down. Never gets a bottom border.
- **Max content width is 1100px**, centered, with 14–32px horizontal padding.
- **Two-column grids kick in at 900px** — below that, collapse to single column.
- The `.wrap` page container has **74px top margin** to clear the fixed header + its own 16px radius — it looks like a glass slab floating under the nav.

---

## Index — files in this system

| File | Purpose |
|---|---|
| `README.md` | You are here. System overview, content + visual rules. |
| `SKILL.md` | Agent Skills entrypoint — load this system as a skill in Claude Code. |
| `colors_and_type.css` | CSS variables (colors, type, spacing, radii, shadows, motion) + `.wt-*` semantic utility classes. |
| `assets/` | Logos, brand mark, topo-line texture, PWA icons. |
| `preview/` | Small HTML cards registered in the Design System tab — one per token cluster. |
| `ui_kits/web/` | UI kit for the WizTrail web app + landing. `index.html` is the clickable demo. |

### UI kits
- `ui_kits/web/` — marketing landing + calculator app, with Header, Hero, KPIs, GPXDropzone, WDILadder, FeatureCard, Button, Input, Tab, Footer.

---

## Iconography

WizTrail has **no dedicated icon font**. Icons come from three sources, in this order of preference:

1. **Inline SVG, hand-crafted, 24×24, stroke-based.** This is the primary style — `stroke-width: 1.5` or `1.25`, `stroke-linecap: round`, `stroke-linejoin: round`, `fill: none`, `stroke: currentColor`. Matches the Feather/Lucide aesthetic. See the GPX dropzone upload arrow + the scroll-hint mouse in `landing.html` for canonical examples.
2. **Emoji** as a fallback for feature cards and privacy rows — only on marketing surfaces, never inside the app chrome. Current set in use: ⛰️ ⏱️ 📊 🗺️ 🏃 📋 🔒 📵 📱 📂 📺 ✓ ✕ ←/→. This is pragmatic: the team hasn't invested in a proper icon set yet.
3. **Brand-specific glyphs** drawn inline: the Strava orange "S" is a hardcoded SVG in the dropzone alt link. The logo "W" is the only proprietary shape.

**CDN substitution (flagged):** for this design system, prototypes can use **Lucide icons** (via `https://unpkg.com/lucide@latest`). They match the existing hand-SVG stroke style 1:1. Treat Lucide as the de-facto icon set until the team picks one officially.

**Logo assets available:**
- `assets/logo.svg` — the full W-on-dark-teal radial mark (192×192).
- `assets/logo-mark.svg` — minimal glyph version.
- `assets/logo-192.png`, `assets/logo-592.png` — PWA icons (rasterized).

**Do not:**
- Draw decorative SVGs (mountains, trees, wavy lines) outside of the topo texture — imagery is photographic (landing hero) or absent.
- Use filled/material icons — the aesthetic is strictly stroke-based.
- Use colored icons — icons inherit `currentColor`, usually teal or muted.

---

## Font substitution flag

Both **Outfit** and **DM Mono** are loaded from Google Fonts (`fonts.googleapis.com`) — no local font files exist in the source repo. This system follows the same pattern: **no local `fonts/` folder**, fonts are pulled from Google Fonts via `@import` at the top of `colors_and_type.css`.

**If offline/embeddable outputs are needed**, the fonts will need to be self-hosted. Please provide `.woff2` files for:
- Outfit — weights 300, 400, 500, 600, 700, 900
- DM Mono — 400 regular + 400 italic

---

## Caveats

- The source repo does **not** commit font files — we rely on Google Fonts. Flagged above.
- The source repo uses **emoji as icons** on feature cards; the system inherits that but recommends Lucide for new work. Flagged in ICONOGRAPHY.
- Hero photography (`img/hero-*.jpg`, 2–4 MB each, credited to Brian Erickson / Unsplash) was **not imported** to save space. The landing UI kit uses a placeholder + the topo texture instead. Ask the user if a real photo is needed.
- Light theme is preserved as CSS tokens but not demoed — the app ships dark by default.
