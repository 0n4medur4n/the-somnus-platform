# somnus-app

The Somnus platform's authenticated **SPA** (Vite + React + TypeScript). It
talks **only to `somnus-edge-api`** (build plan §5.2) — never to internal
services or a database — and is deployed to Firebase Hosting (a separate
site/target from marketing; hosting config lands in Checkpoint 9.2).

## Stack (build plan §3.2)

Vite 7 · React 19 · react-router 7 · TanStack Query 5 · react-hook-form +
Zod resolvers · i18next / react-i18next (es/en/ca/fr, default es) · Tailwind 4 ·
Firebase Auth (client). Vitest + Testing Library for component/unit tests;
Playwright for E2E. Contract types come from `@somnus/api-contracts` (the Zod
single source of truth), so request/response shapes match edge-api exactly.

## Auth (build plan §10)

Passwordless **email link** via Firebase (Auth emulator locally). The flow:
sign-in link → `/auth/callback` completes it → the ID token is exchanged for
an **HttpOnly session cookie** at `POST /v1/sessions` → the token is discarded.
A first-time user is **provisioned** at `POST /v1/registration`. Every later
request rides the cookie; the SPA never reads or stores it.

**No tokens in browser storage.** Firebase Auth uses `initializeAuth` with
`inMemoryPersistence`, so no refresh token ever reaches localStorage/IndexedDB.
`src/auth/no-token-storage.test.ts` guards this at the unit level; the E2E
asserts it after a real sign-in.

## Accessibility baseline (build plan §20 9.1)

Skip link, always-visible focus ring, semantic headings, labeled fields with
`aria-describedby` hints/errors, focusable `role="alert"` error summaries,
`role="status"` live regions, `prefers-reduced-motion` support, brand-contrast
tokens, and no color-only status. Verified by axe-core in the E2E (zero
violations on login + profile).

## Routes

`/login`, `/auth/callback`, `/app`, `/app/profile`, `/app/security`,
`/professional`, `/professional/profile`, `/organization`,
`/organization/members`, `/organization/invitations`. The golden-path routes
are fully functional; the rest are accessible, localized scaffolds (their full
behavior lands in later phases — 9.1 is the SPA *foundation*).

## Commands

```bash
pnpm --filter @somnus/app dev            # dev server on :5173
pnpm --filter @somnus/app typecheck      # strict tsc
pnpm --filter @somnus/app test:coverage  # component/unit tests + i18n completeness
pnpm --filter @somnus/app build          # production bundle
pnpm --filter @somnus/app e2e            # Playwright golden path (needs the stack)
```

Config is via `VITE_*` env vars (`src/config/env.ts`), all public — no secrets
in the browser. Defaults target the local emulator + docker stack. See
`tests/e2e/README.md` for the E2E stack.
