# ADR 0009 — Static frontends on Firebase Hosting (Astro marketing, Vite+React SPA)

- Status: Accepted
- Date: 2026-07-21
- Phase: 1.2
- Decides: §3.1 (Marketing site), §3.2 (Application SPA), §5.1, §5.2

## Context

Frontends running on Cloud Run add cold starts, cost, and an extra
trust boundary for code that is essentially a static bundle. The
Somnus frontends have no per-user server state; the SPA is fully
client-rendered and the marketing site is content.

## Decision

Two separate Firebase Hosting sites, both built at CI time:
- `somnus-marketing` — Astro, static output, no SSR adapter. SEO,
  pricing, legal pages, blog. Localized in `es / en / ca / fr`.
- `somnus-app` — Vite + React SPA. Authenticated flows, forms,
  organization administration, assessment, results. Talks only to
  `somnus-edge-api`; never stores tokens in `localStorage`; never calls
  internal services directly.

Both deploy previews are produced by CI. Routing, redirects and
headers are configured per Hosting site.

## Consequences

- No frontend cold starts, near-zero hosting cost.
- The marketing site is fully indexable and CDN-cached.
- A security regression in the SPA cannot leak secrets because there
  are none in the bundle.
- Any change to either frontend is a build + deploy, not a service
  restart.
