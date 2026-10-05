# ADR 0016 — Same-site API front door through Firebase Hosting

- Status: Superseded by ADR 0017 (one project per environment; the API same-origin with each SPA)
- Date: 2026-10-05
- Decides: §10 (session cookie), §21 (CSRF); refines ADR 0008 and ADR 0009

## Context

The SPAs are served from `app.thesomnus.com` and `console.thesomnus.com`;
`somnus-edge-api` answers on its Cloud Run URL, `*.run.app` — a different
site. Its session cookie was therefore a third-party cookie
(`SameSite=None`). Safari and every iOS browser block third-party cookies
by default, including the in-app browser Gmail opens magic links in; so do
Chrome and Firefox when a user turns them off. There, sign-in fails
silently.

The same cross-site split had already broken CSRF on 2026-10-05: the token
lived in a cookie the SPA could not read from another site (fixed by
delivering it in response bodies).

## Decision

Serve the API at `api.thesomnus.com`, same registrable domain as both
SPAs, so the session cookie is first-party everywhere and can be
`SameSite=Lax`.

`api.thesomnus.com` is a Firebase Hosting site in the backend project
(`the-somnus`) whose only configuration is a rewrite of every path to
`somnus-edge-api`. It serves no files and is not a new deployable.

Rejected:
- **Cloud Run domain mapping** — unavailable in `europe-west3`; preview
  and not production-ready per Google.
- **Global external Application Load Balancer** — works, ~18–20 USD/month;
  build plan §2 puts cost first.
- **A rewrite from the existing SPA Hosting sites** — they live in
  `the-somnuss`, and a Hosting rewrite can only reach Cloud Run in its own
  project.

## Consequences

- Firebase Hosting forwards only the cookie named `__session` to Cloud
  Run. edge-api sets exactly one cookie, `__session`, and the CSRF token
  is an HMAC of the session id under a key derived from `COOKIE_SECRET`
  (OWASP signed double-submit) instead of a secret in a second cookie.
  `@fastify/csrf-protection` is removed.
- The SPAs call `https://api.thesomnus.com`. CORS still applies (different
  origin, same site). `*.web.app` / `*.firebaseapp.com` SPA URLs are
  cross-site to it and are not supported entry points for signed-in use.
- One extra hop through Hosting's CDN. Dynamic responses are
  `Cache-Control: private` by default, and every token response is
  `no-store`.
- DNS for `api.thesomnus.com` is manual at Cloudflare, DNS-only, like
  `console.thesomnus.com`.
- `somnus-edge-api` must stay publicly invokable for Hosting to reach it
  (ADR 0008 unchanged in substance: it is still the only public service).
