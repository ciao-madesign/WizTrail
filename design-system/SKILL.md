---
name: wiztrail-design
description: Use this skill to generate well-branded interfaces and assets for WizTrail, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick reference (DS v1.1 — 2026)

- **Vibe**: tool, not a fitness app. ACG-inspired, IGM-grounded. Dark mode, off-black panels, lime accent, topo texture overlay, sharp geometry.
- **Colors**: `--wt-bg #111111`, `--wt-surface #1C1C1C`, `--wt-surface-2 #2E2E2E`, `--wt-ink #F3F2F0`, `--wt-ink-muted #6A6A6A`, `--wt-border #2E2E2E`, `--wt-accent #B8D400`.
- **Type**: Inter (UI/body), Neue Haas Grotesk→Inter (display headings), JetBrains Mono (data values, pacing, KPIs). Load via Google Fonts `<link>` in HTML `<head>` — no `@import` in CSS.
- **Tone**: Italian, tu form (informal), direct, functional. Short sentences. No emoji in UI. No gamification. "WDI, TechScore, Pacing. Dal GPX al piano di gara."
- **Motif**: topographic contour lines at 6–9% opacity via `::before` pseudo-element with `isolation:isolate` + `z-index:-1` on parent. Applied to `.card`, `.kpi-primary`, `.gpx-dropzone`, `.feature-card`.
- **Radii**: max 4px. Three steps: 0 (flat), 2px (cards/buttons/inputs), 4px (tags/chips). No soft radius (10px+).
- **WDI palette** (data only, not brand): Sport `#4E7C59` · Pro `#A8B94F` · Advanced `#D4A843` · Extreme `#C06030` · Elite `#8B2020` · Legend `#C8C8C8`.
- **Don't**: teal, glass/blur effects, rounded corners (10px+), emoji in UI, motivational copy, fitness-app styling.

See `README.md` and `colors_and_type.css` for the full system, and `ui_kits/web/` for reference components.
