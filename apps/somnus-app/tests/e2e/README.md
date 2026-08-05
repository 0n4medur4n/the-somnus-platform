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
5. **the SPA** dev server on `:5173`, built with
   `VITE_AUTH_EMULATOR_URL=http://127.0.0.1:9099` and
   `VITE_EDGE_API_URL=http://localhost:8080` (Playwright starts this itself).

## Run

```bash
just dev-up                                   # MySQL + emulators
pnpm --filter @somnus/app e2e:install         # Playwright Chromium (first time)
# start identity (:3001) and edge-api (:8080) against the emulators, then:
pnpm --filter @somnus/app e2e
```

The Auth emulator sends no real mail; the sign-in link is read back from its
REST API (`tests/e2e/support/emulator.ts`), which stands in for the inbox.

## Accessibility

`golden-path.spec.ts` runs **axe-core** on the login and profile screens and
fails on any violation — the same engine Lighthouse's accessibility category
uses. `lighthouserc.json` additionally scores the public login screen at
≥ 0.95 (`pnpm dlx @lhci/cli autorun` with the SPA served on `:5173`).
