# @somnus/nox

Professionals-only SPA for Nox. Vite, React, TypeScript, Tailwind 4, and the
same four locales as `somnus-app` (`es` default, `ca`, `en`, `fr`).

Visual tokens come from `@somnus/ui-tokens` (Inter, three themes, Tailwind's
default spacing and radius). This app does not import `somnus-app`.

## Gate

Firebase magic link, same project variables as the patient SPA
(`VITE_FIREBASE_*`). Auth persistence is in memory only. After a Firebase
user exists, the shell calls **only** `GET /nox/v1/me`.

The response type in `src/api/nox-me.temporary.ts` is marked **TEMPORARY**
until `packages/api-contracts` owns it. An explicit grant is both
`verifiedProfessional: true` and `noxAccess: true`, with no other fields.
Every other body, HTTP error, timeout, or unknown state renders the denial
screen and nothing else. Signed-out visitors see the login screen.

Dev and tests resolve that call to `src/api/nox-me.mock.ts`. A production
`vite build` (`mode === "production"`) resolves `src/api/nox-me.live.ts`
instead. `?preview=dashboard` and `?preview=denied` exist only on the mock.

Ports: dev `5175`, preview `4175` (app is 5173, admin is 5174).

## Not in this change

No Hosting site, no CI job, no Terraform, no edge route. The CI jobs this
app will need, and that are **not** added here:

1. `somnus-nox` — same shape as `somnus-admin`: frozen install, build
   `@somnus/api-contracts`, `pnpm --filter @somnus/nox typecheck`,
   `test:coverage`, `build`.
2. `quality-gate` already lints this tree and runs `packages/ui-tokens`
   tests, including the drift test. It does not typecheck or build the SPA.
3. `deploy-hosting` — a later change, once the Hosting site exists. Do not
   add it before that site is in Terraform.

`vitest.config.ts` at the repo root excludes `apps/somnus-nox/**` so the
node runner does not execute this jsdom suite. That is the same registration
the other SPAs use.
