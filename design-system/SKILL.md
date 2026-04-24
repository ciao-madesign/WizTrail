---
name: wiztrail-design
description: Use this skill to generate well-branded interfaces and assets for WizTrail, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick reference

- **Vibe**: outdoor dark-mode, near-black panels, teal accent, subtle topo texture, generous spacing, italic teal emphasis on key nouns.
- **Colors**: `--wt-bg #0b1417`, `--wt-card #121c20`, `--wt-panel #0f181c`, `--wt-ink #e9f2f1`, `--wt-muted #9db2b1`, `--wt-teal #4fd1c5`, `--wt-border #1e2a30`.
- **Type**: Outfit (display, 300/400 weight, italic emphasis), Inter (body/UI), DM Mono (tabular data). Serve from `fonts/` or Google Fonts.
- **Tone**: Italian, tu form (informal), confident, non-gamified. Short sentences. "Ogni salita ha un *peso preciso*."
- **Motif**: topographic contour lines at ≤8% opacity; teal radial ambient glows; glass slabs with `backdrop-filter: blur`.
- **Don't**: bluish-purple gradients, emoji cards with accent left-border, fitness-app styling, fake stadium metrics, heavy photography.

See `README.md` and `colors_and_type.css` for the full system, and `ui_kits/web/` for reference components.
