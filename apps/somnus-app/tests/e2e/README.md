# SPA end-to-end tests (build plan §20 Checkpoint 9.1)

The golden path — **register → login → edit profile → create organization →
invite → accept → logout** — run once in `es` and once in `ca`, plus the
accessibility baseline (axe, zero violations on login + profile) and the
assertion that **no Firebase token is ever persisted in the browser**.

The E2E exercises the whole platform, so it needs the full local stack, not
just the SPA:

1. **MySQL 8** (TiDB stand-in) — `just dev-up`.
2. **Firebase Auth + Firestore emulators** — Auth on `9099`, Firestore on `9098`.
3. **identity-service** on `:3001`, its schema migrated (`somnus_identity` +
   `somnus_consent`).
4. **edge-api** on `:8080`, pointed at the emulators and identity
   (`INTERNAL_AUTH_MODE=insecure-dev`, `IDENTITY_BASE_URL=http://localhost:3001`).
5. **the SPA**: the production bundle, served by `vite preview` on `:5173` with the
   security headers of `firebase.json` (see below), built with
   `VITE_AUTH_EMULATOR_URL=http://127.0.0.1:9099` and
   `VITE_EDGE_API_URL=http://localhost:8080` (Playwright starts this itself).

## Run

`scripts/e2e-stack.mjs` starts the compiled identity (:3001) and edge-api
(:8090, to dodge a common local Apache on 8080) against the emulators + docker
MySQL, waits for health, then runs Playwright (which serves the SPA on :5173).

```bash
just dev-up                                          # MySQL (creates the logical databases)
pnpm --filter @somnus/identity-service db:migrate    # migrate somnus_identity + somnus_consent
pnpm --filter @somnus/app e2e:install                # Playwright Chromium (first time)
pnpm -r --filter "./packages/*" build
pnpm --filter @somnus/identity-service --filter @somnus/edge-api build
pnpm exec firebase emulators:exec --only auth,firestore \
  --project somnus-dev-test \
  --config services/somnus-edge-api/test/firebase.emulators.json \
  "node scripts/e2e-stack.mjs"
```

Set `PW_GREP="es:"` to run a single locale. CI runs exactly this in the
**App SPA E2E (full stack)** job; verified green in `es` and `ca`.

The Auth emulator sends no real mail; the sign-in link is read back from its
REST API (`tests/e2e/support/emulator.ts`), which stands in for the inbox.

`scripts/e2e-stack.mjs` starts edge-api with a raised `RATE_LIMIT_MAX`. The
limiter (build plan §21) is global and keyed by client IP, so the whole suite --
nineteen sequential tests plus the script's own health polls -- shares a single
budget of 100 requests per minute. Once it is spent, later tests take 429s on
`POST /v1/sessions` that have nothing to do with what they are testing. The
limit itself does not move: dev, staging and production all still run on
edge-api's schema default, and `tests/e2e-rate-limit.test.ts` fails if the
harness value ever stops diverging from it.

Browser console errors are forwarded into the test output by an auto fixture
(`tests/e2e/support/console.ts`), which also logs one line per magic-link
redemption. Both routes a context can be created by are covered, and
`console-forwarding.spec.ts` fails if either stops being wired -- a diagnostic
whose failure mode is silence needs its own test.

## Accessibility

`golden-path.spec.ts` runs **axe-core** on the login and profile screens and
fails on any violation — the same engine Lighthouse's accessibility category
uses. `lighthouserc.json` additionally scores the public login screen at
≥ 0.95 (`pnpm dlx @lhci/cli autorun` with the SPA served on `:5173`).

## Content-Security-Policy

The suite does not use the Vite dev server. Playwright builds the SPA (`build:e2e`)
and serves it with `vite preview`, answering with the headers `firebase.json`
gives the app (`E2E_SECURITY_HEADERS=1`, `vite.config.ts`). The preview adds the
local edge-api and Auth emulator origins to `connect-src`, and the edge-api
origin only to `img-src`, because those calls leave the page's origin only
inside this suite. The shipped policy is unchanged. `support/console.ts` records every `securitypolicyviolation`,
including Report-Only, and an automatic fixture fails the test that caused it,
in every spec (es and ca).
