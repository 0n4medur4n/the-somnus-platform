# Hosting security headers (task S1)

Applies to the three public sites: `app.thesomnus.com` (somnus-app), `console.thesomnus.com`
(somnus-admin) and `thesomnus.com` (somnus-marketing). Source of truth: `firebase.json`.

## What went wrong

`firebase.json` set `X-Frame-Options`, `X-Content-Type-Options`, `Permissions-Policy` and the
cache policy on the rule `**/*.html`. Hosting matches a header rule against the **request URL**,
not against the file it serves. `/`, `/login` and `/app` never end in `.html`, so none of them
matched and the sites sent only Hosting's own defaults (`Cache-Control: max-age=3600`, HSTS).
Only URLs that really end in `.html` matched: the marketing 404 page, and `/anything.html`
(rewritten to `index.html` on the SPAs).

Evidence (2026-11-10, read-only requests): `https://thesomnus.com/login` (a 404) carried every
header of the old rule, while `/`, `/es/`, and on the SPAs `/login` and `/app` carried none. The
deployed HSTS value of that 404 (`max-age=31536000; includeSubDomains`) is the one in the file, so
the config was deployed; it simply never matched the pages.

A side effect: HTML was cached for an hour (`max-age=3600`), so after a deploy a visitor could keep an
`index.html` pointing at assets the new release no longer has.

## The fix

One rule per site, `source: "**"`, carrying every header, followed by the hashed-asset rule (which
overrides `Cache-Control` for `assets/` and `_astro/`; rules apply in order and the last one wins for
a repeated header: true of Hosting's router as shipped in firebase-tools, and confirmed on the live site by the asset check below). `scripts/check-live-headers.mjs` asks the live sites after every deploy and
fails if any header is missing or if an asset lost its immutable cache.

| Header | app | console | marketing |
|---|---|---|---|
| Content-Security-Policy | full | partial (see below) | header + per-page `<meta>` |
| X-Content-Type-Options | nosniff | nosniff | nosniff |
| X-Frame-Options | DENY | DENY | DENY |
| Referrer-Policy | strict-origin-when-cross-origin | same | same |
| Permissions-Policy | `geolocation=(), microphone=(self), camera=()` | same | `geolocation=(), microphone=(), camera=()` |
| Cross-Origin-Opener-Policy | same-origin | same-origin | same-origin |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` | same | `max-age=31536000` |
| Cache-Control (HTML) | no-cache | no-cache | no-cache |
| X-Robots-Tag | | noindex, nofollow | |

* COOP `same-origin` is safe because sign-in is the email link (no popup, no `window.opener`).
* HSTS on the apex (`thesomnus.com`) has no `includeSubDomains`: the old rule had it, but it would
  commit every subdomain of the company to HTTPS for a year and nobody has listed them. Owner decision.
* `Cache-Control: no-cache` (not `public, max-age=0`): the `**` rule also reaches `/v1/**` responses
  forwarded to edge-api, which are per-person; nothing there should be marked public.

## CSP, directive by directive

### somnus-app (full policy in the header)

```
default-src 'none'
script-src  'self' blob:
style-src   'self'
img-src     'self' data: blob:
font-src    'self'
connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com wss://streaming.eu.assemblyai.com
manifest-src 'self'
frame-src   'none'
object-src  'none'
base-uri    'self'
form-action 'self'
frame-ancestors 'none'
```

| Directive | Why |
|---|---|
| `default-src 'none'` | Nothing is allowed unless named below. |
| `script-src 'self' blob:` | The Vite bundle is same-origin. `blob:` is the dictation worklet, built from a string and loaded with `audioWorklet.addModule(blobUrl)` (`dictation.ts:244-246`); worklets are governed by `script-src`. No `unsafe-inline`, no `unsafe-eval`. |
| `style-src 'self'` | Tailwind is a built CSS file; React sets `style` through the CSSOM, which CSP does not block. |
| `img-src 'self' data: blob:` | Brand images, the profile photo (`/v1/me/photo`, same origin), small inlined assets (`data:`), the photo preview (`blob:`). |
| `font-src 'self'` | No web fonts are loaded from elsewhere. |
| `connect-src` | `'self'`: the `/v1` API through the Hosting rewrite. The two Google hosts are the only endpoints Firebase Auth's email-link sign-in calls (`initializeAuth`, no popup, no iframe). `wss://streaming.eu.assemblyai.com` is the dictation socket (`dictation.ts:256`; host from the worker's `ASSEMBLYAI_STREAMING_URL`, which only accepts an `*.assemblyai.com` host). |
| `manifest-src 'self'` | Future web app manifest. |
| `frame-src 'none'`, `object-src 'none'` | The app embeds nothing. |
| `base-uri`, `form-action 'self'` | Stops an injected `<base>` or `<form>` redirecting traffic. |
| `frame-ancestors 'none'` | Nobody may frame the app (paired with `X-Frame-Options: DENY`). |

One code change was needed for this: Zod 4 probes `new Function("")` to compile schemas, which an
`unsafe-eval`-free policy refuses on every load. `apps/somnus-app/src/lib/zod-config.ts` sets
`z.config({ jitless: true })` (first import of `main.tsx`) instead of allowing eval.

### somnus-marketing (header + a hash policy per page)

Astro 7's built-in CSP (`security.csp`) writes a `<meta>` policy per page with the SHA-256 of every
inline script and `<style>`. `scripts/csp-hashes.mjs` runs after `astro build` and completes it with
what Astro leaves out: the `is:inline` scripts, the generated redirect pages, and the `style="..."`
attributes (`style-src-attr 'unsafe-hashes'`, one hash per distinct value). Nothing is `unsafe-inline`.
The header carries the rest: `img-src 'self' data:`, `font-src 'self'`, `connect-src 'self'`,
`media-src`, `worker-src`, `manifest-src 'self'`, `frame-src 'none'`, `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`. The header has no `script-src` or
`style-src` on purpose: a header policy and a meta policy are intersected, so a header `script-src`
would block the hashed inline scripts. `apps/somnus-marketing/tests/csp.test.ts` checks every built
page covers all of its inline code.

### somnus-admin: partial policy, owner decision pending

The header has everything except `default-src`, `script-src` and `style-src`: `connect-src`
(self, the two Google hosts, the dictation socket), `img-src`, `font-src`, `media-src`, `worker-src`,
`manifest-src`, `object-src 'none'`, `base-uri`, `form-action`, `frame-ancestors 'none'`.

Why not a full policy: the Drive viewers (HTML files, PDFs, spreadsheets, annotated pages) run inside
`<iframe sandbox srcdoc>` frames (`html-view.ts`, `PdfFrame.tsx`, `SheetFrame.tsx`, `annotated-page.ts`).
A `srcdoc` frame **inherits the embedding page's policy** and adds its own. Those frames need inline
script, inline style and `eval` (a user's HTML file is a program; pdf.js and the spreadsheet engine
start from `eval`). Tested in Chromium: with `script-src 'self'` on the console, a frame's script never
runs. So a strict `script-src` on the console page forbids the Drive viewers, and the alternative is
`unsafe-inline`/`unsafe-eval` on the whole console. Neither is acceptable without a decision.

Options (for the owner):

1. Keep the partial policy (it already blocks exfiltration through `connect-src` and framing).
2. Move the frames to their own documents under a path with its own, looser header rule
   (for example `/viewer/**`), sandboxed, fed by `postMessage`. The console page then gets the strict
   policy. Needs a change in five Drive components and a visual check of every viewer.

## Checks in CI

* `tests/hosting-headers.test.ts`: parses `firebase.json`; fails if a site loses a required header, if
  another rule overrides one, if a CSP gains `unsafe-inline`/`unsafe-eval`/`*`/`http:`, or if the list of
  sites that carry no `script-src` in the header grows.
* `apps/somnus-marketing/tests/csp.test.ts`: every built page's inline code is hashed.
* Playwright (`apps/somnus-app/tests/e2e`): the suite runs the production bundle under the production
  policy and fails the test that causes any `securitypolicyviolation` (es and ca).
* `scripts/check-live-headers.mjs`, after `deploy-hosting` on push to main: `/`, `/login`, `/app` on each
  custom domain.

## Service worker and manifest

Static files win over rewrites, but a missing `sw.js` would be answered by the SPA's `index.html`. The
app has explicit rewrites `/sw.js → /sw.js` and `/manifest.webmanifest → /manifest.webmanifest`
(placed before the catch-all): the file is served when it exists, a real 404 otherwise. Both get
`Cache-Control: no-cache`, so a new worker is picked up on the next load. Not verified outside the
Hosting emulator; check it on a preview channel when the first service worker is added.

## For a future wellness area (nothing is added now)

| Need | Directive / header |
|---|---|
| Service worker | `worker-src 'self'` (falls back to `script-src 'self'`, already enough); `sw.js` is covered by the `**` rule; `manifest-src 'self'` exists. No `importScripts` from another origin. |
| IndexedDB | None: storage is not governed by CSP. |
| Web Push | None for the Push API itself (the browser talks to the push service). The subscription is posted to our API (`connect-src 'self'`); notification icons need `img-src 'self'`. |
| Text reader | Text only: nothing. Rendering Markdown/HTML needs a sanitizer and classes, not `style=""` attributes (`style-src 'self'` blocks them). Custom reading fonts: ship them (`font-src 'self'`). |
| Audio later (Siren) | `media-src 'self' blob:` plus the bucket origin if media is served from storage; `connect-src` for range requests. |
| Hardening to consider | `require-trusted-types-for 'script'` once the app has no DOM-string sinks. |
