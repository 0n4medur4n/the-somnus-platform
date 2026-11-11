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
| Content-Security-Policy | `frame-ancestors 'none'` only | `frame-ancestors 'none'` only | header + per-page `<meta>` |
| Content-Security-Policy-Report-Only | the rest of the policy | the rest, plus candidate `default-src` / `script-src` / `style-src` | none |
| X-Content-Type-Options | nosniff | nosniff | nosniff |
| X-Frame-Options | DENY | DENY | DENY |
| Referrer-Policy | strict-origin-when-cross-origin | same | same |
| Permissions-Policy | `geolocation=(), microphone=(self), camera=()` | that, plus `publickey-credentials-get=(self)` and `publickey-credentials-create=(self)` | `geolocation=(), microphone=(), camera=()` |
| Cross-Origin-Opener-Policy | same-origin | same-origin | same-origin |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` | same | `max-age=31536000` |
| Cache-Control (HTML) | no-cache | no-cache | no-cache |
| X-Robots-Tag | | noindex, nofollow | |

* COOP `same-origin` is safe because sign-in is the email link (no popup, no `window.opener`).
* HSTS on the apex (`thesomnus.com`) has no `includeSubDomains` (owner decision, 2026-11-10): the old
  rule had it, but it would commit every subdomain of the company to HTTPS for a year and nobody has
  listed them. Revisit once a subdomain inventory exists.
* `Cache-Control: no-cache` (not `public, max-age=0`): the `**` rule also reaches `/v1/**` responses
  forwarded to edge-api, which are per-person; nothing there should be marked public.

## CSP, directive by directive

### somnus-app (Report-Only, with framing enforced)

ADR 0027 decision 16 stages the broad policy. Browsers ignore `frame-ancestors`
inside a Report-Only policy, so that one directive is its own enforced header:

```
Content-Security-Policy: frame-ancestors 'none'
```

`X-Frame-Options: DENY` stays. Everything else is `Content-Security-Policy-Report-Only`:

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
```

The enforced policy is not shown to be harmless. CI's full-stack E2E failed
because `img-src` blocked `http://localhost:8090/v1/me/photo` on `/app/profile`.
That URL is the suite's edge-api, not the page. On the live site the photo is
`/v1/me/photo` on the page's own origin, which `'self'` allows. The suite's preview adds the local origins to `connect-src` and the edge-api
origin only to `img-src`; `firebase.json` does not. The app stays Report-Only until a browser pass on the live origin
shows no violations.

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
| `frame-ancestors 'none'` | Enforced on its own header, paired with `X-Frame-Options: DENY`. A Report-Only policy does not enforce it. |

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

### somnus-admin (Report-Only first, ADR 0027 decision 16)

Enforced header, and only this:

```
Content-Security-Policy: frame-ancestors 'none'
```

`X-Frame-Options` stays `DENY`. `Permissions-Policy` is
`geolocation=(), microphone=(self), camera=(), publickey-credentials-get=(self), publickey-credentials-create=(self)`.
Dictation keeps `microphone=(self)`.

`Content-Security-Policy-Report-Only` carries the previous connect, image, font,
media, worker and document directives, and three candidates that are not
enforced: `default-src 'none'`, `script-src 'self'`, `style-src 'self'`. There
is no `frame-ancestors` in the Report-Only policy. `connect-src` still names
`'self'`, `https://identitytoolkit.googleapis.com`, `https://securetoken.googleapis.com`
and `wss://streaming.eu.assemblyai.com`. Those hosts are a hypothesis for the
browser test: the console source does not name the two Google hosts.

The Drive viewers (HTML, PDF, spreadsheet, annotated page) run in `srcdoc`
frames that inherit the page policy and need inline script and `eval`. An
enforced `script-src 'self'` stops them. This PR does not enforce `script-src`
or `style-src`. The candidates are there so the browser console shows the
violations during the check. Enforce the broad policy only after sign-in and
the email-link callback show none.

## Checks in CI

* `tests/hosting-headers.test.ts`: parses `firebase.json`; fails if a site loses a required header, if
  another rule overrides one, if either CSP gains `unsafe-inline`/`unsafe-eval`/`*`/`http:`, if app or
  console enforce anything beyond `frame-ancestors 'none'`, or if the console passkey permissions drop.
* `apps/somnus-marketing/tests/csp.test.ts`: every built page's inline code is hashed.
* Playwright (`apps/somnus-app/tests/e2e`): the suite runs the production bundle under the app's
  headers and fails the test that causes any `securitypolicyviolation`, Report-Only included.
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

## Known gaps

1. **`blob:` in the app's `script-src`.** It exists only for the dictation worklet, built from a string and
   loaded with `audioWorklet.addModule(blobUrl)` (`dictation.ts`). Script injected into the page cannot
   create a blob without already running, so the risk is low, but it is a wider source than `'self'`.
   Fix: ship the worklet as a static same-origin file and load it by URL, then drop `blob:`. Not done here
   because it changes the audio path and could not be tested with a real microphone.
2. **The console does not enforce `script-src` or `style-src`.** The candidates live in the Report-Only
   policy so the browser check can see them. An injected script is not stopped until that policy is
   enforced, after sign-in and the email-link callback show no violations.
3. **The `sw.js` and `manifest.webmanifest` rewrites** (serve the file, else a real 404, never `index.html`)
   and their `no-cache` rule were only tested in the Hosting emulator, which does not apply custom headers.
   Check them on a preview channel when the first service worker is added.
4. **Staging and production** (`infrastructure/terraform/modules/environment`) do not set `COOKIE_SECRET` or
   `COOKIE_SECURE`. With the fail-closed edge-api configuration an edge-api started there without them
   refuses to start. Fill them in before those environments are used.
5. **CI's full Playwright run failed once** on `tests/e2e/morpheo-space.spec.ts:91`: the profile image
   was not visible, and the CSP guard reported `img-src` blocking the suite's edge origin. The shipped
   `img-src` stayed `'self'`. The preview now adds that origin for the suite only.
6. **The app's `test:coverage` suite is load-sensitive.** On a busy machine the same tests time out at the
   default 5 s on `origin/main` too (see the S1 closing report); not caused by this work, not fixed here.
