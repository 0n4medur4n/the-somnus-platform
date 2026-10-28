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
until `packages/api-contracts` owns it. An explicit grant requires
`verifiedProfessional: true` and `noxAccess: true`. Unknown keys are
ignored. A missing field, a value that is not literal true, an HTTP error,
a timeout, or a non-object body renders the denial screen and nothing
else. Signed-out visitors see the login screen.

The mock (`src/api/nox-me.mock.ts`) and the `?preview=` bypass are opt-in.
Vite aliases them only when the mode is `development` or `test`. Every
other mode, including `production`, `staging`, and a `vite build` with no
`--mode`, resolves `src/api/nox-me.live.ts`.

Ports: dev `5175`, preview `4175` (app is 5173, admin is 5174).

## NOT FOR DEPLOY

Do not deploy this app. Login sends the magic link with Firebase's own
`sendSignInLinkToEmail`. The patient SPA (`apps/somnus-app`) does not do
that on the deployed site: `hosting.dev.json` sets `VITE_SIGN_IN_EMAIL` to
`somnus`, and the link is requested from the edge
(`edge.requestSignInLink`). Nox must not be deployed until its login goes
through the edge the same way. There is no Hosting target, no workflow,
and no Terraform for this app in this change.

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
