# @somnus/design-system

Brand tokens from build plan §4: color, font fallback stack, spacing,
and radius. Frozen objects, exported as TypeScript constants, CSS
custom properties, and JSON. The single source of truth for visual
identity across the marketing site, the SPA, the report templates,
and any future surface.

## How to consume

- **TypeScript / NestJS / report templates**: import `BRAND_TOKENS`.
- **Web frontends (Astro, Vite, plain CSS)**: import
  `@somnus/design-system/tokens.css` and use the `--somnus-*` custom
  properties.
- **JSON consumers** (e.g. third-party tooling): import
  `@somnus/design-system/tokens.json`.

## What does NOT live here

- Components. The marketing site and the SPA have their own React/
  Astro components.
- Logos or asset files. Brand assets (logo, favicons) are not
  versioned in this package; the marketing site owns its `public/`
  folder and the SPA owns its `public/` folder. See `README.md` at
  the repo root for the rationale.
- A second source of brand truth. If a value differs from this
  package, this package wins.

## Build plan

Implements build plan §4 (brand foundation) and §20 Phase 2 /
Checkpoint 2.2.
