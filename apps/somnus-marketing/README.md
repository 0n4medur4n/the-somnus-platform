# @somnus/marketing

Static marketing site for **The Somnus** (initial product: **Morpheo**), built
with [Astro](https://astro.build) in static output mode and deployed to
Firebase Hosting. Pinned decisions: build plan §3.1, §3.3, §5.1; ADR 0009
(static frontends on Firebase Hosting); ADR 0012 (four-locale i18n).

## Stack

- **Astro 7** (`output: "static"`, no SSR adapter).
- **Tailwind CSS 4** via `@tailwindcss/vite`.
- **TypeScript** (strictest Astro preset; never weakened).
- Brand tokens from `@somnus/design-system` (CSS variables in
  `src/styles/global.css`).

## Internationalization

Four locales, `es` (default), `en`, `ca`, `fr` — build plan §3.3 / ADR 0012.

- Every locale is path-prefixed: `/es/`, `/en/`, `/ca/`, `/fr/`.
- The root `/` performs **automatic language detection** in the browser
  (`Accept-Language` via `navigator.languages`, respecting a
  `localStorage` override) and redirects to the chosen locale. A
  `<meta http-equiv="refresh">` fallback sends no-JS visitors to the
  default `es` locale.
- Every page emits `<link rel="alternate" hreflang="...">` for the four
  locales plus `x-default`.
- All user-facing strings live in `src/i18n/{es,en,ca,fr}.json`. A
  missing key in any locale fails CI (see
  `src/i18n/completeness.test.ts`, which reuses `@somnus/i18n`).

## Scripts

```bash
pnpm --filter @somnus/marketing dev       # local dev server
pnpm --filter @somnus/marketing build     # static build -> dist/
pnpm --filter @somnus/marketing preview   # preview the build
pnpm --filter @somnus/marketing check     # astro check (TS + a11y hints)
```

## Deployment

Firebase Hosting, target `marketing` (root `firebase.json`). The app SPA
uses a separate target (`app`). See the root `firebase.json` and
`.firebaserc`.

This directory intentionally contains **no secrets**. The Firebase web
SDK is not used on the marketing site (no auth, no analytics yet).