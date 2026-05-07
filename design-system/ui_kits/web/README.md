# WizTrail Web UI Kit (DS v1.1)

Pixel-level recreation of the WizTrail landing page + calculator app, built as reusable React components.

> **Note:** These components reflect DS v1.1 token names. Colors are lime (#B8D400), not teal. Radii are max 4px. No glass/blur. See `design-system/README.md` for full system documentation.

## Files
- `index.html` — clickable demo: landing → "Apri l'app →" → calculator tab system.
- `components.jsx` — all React components.
- `components.export.jsx` — same, export-formatted.
- `index.export.html` — standalone export.

## Key components
- `Header` — fixed transparent header with logo lockup and nav.
- `Hero` — full-bleed landing hero with topo texture overlay.
- `Button` — Primary (lime/dark) / Secondary / Ghost / Link.
- `FeatureCard` — 3×2 feature grid card.
- `WDILadder` — six-class WDI scale with colored dots + examples.
- `GPXDropzone` — dashed lime drop area + Strava alt.
- `Field`, `Select` — labeled inputs.
- `Tabs` — Calcolatore / Pacing / Mappa / Feedback switcher.
- `KPICard` — primary KPI tile + interval row (Mono font).

All components are recreations, not production logic. See source repo `ciao-madesign/WizTrail@backend` for the real implementations.
