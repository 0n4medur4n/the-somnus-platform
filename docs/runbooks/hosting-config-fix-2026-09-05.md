# Hosting configuration incident — 2026-09-05

## Result

The dev SPA was redeployed to the existing `the-somnus-app` Hosting site in
`the-somnuss`. Chromium verified `https://app.thesomnus.com/login` renders and
requests `https://somnus-edge-api-lx3fvb5r5q-ey.a.run.app/v1/me`, receiving the
expected unauthenticated **401** with no failed requests or page errors. The
edge preflight returned **204**, `Access-Control-Allow-Origin:
https://app.thesomnus.com`, and `Access-Control-Allow-Credentials: true`.

The served JavaScript is byte-identical to the guarded local artifact:

- Asset: `/assets/index-DbRk0gxl.js`.
- SHA-256: `1c0f25e71d29982fd5f74c8d0d95dc16af492c4f3e4af147da106cf5e95a8b2b`.
- Firebase project: `the-somnuss`.
- Firebase auth domain: `the-somnuss.firebaseapp.com`.
- Firebase web app: `1:131552832912:web:f90ead739b307593ad5715`.
- `demo-api-key` is absent from the served bundle.

**Not yet demonstrated:** a successful real `accounts:sendOobCode` request or
email delivery. A recipient address was requested and has not been supplied.
No magic link was sent, no account was created, and no privileged role was
assigned. The complete exit criteria are therefore still pending.

Workflow and guard changes are in the working tree; this session did not commit
or push them. The remote CI workflow must receive these changes for future
remote builds to enforce the new guard. The direct deployment did execute the
local Firebase predeploy hook successfully.

## Cause and changes

`src/config/env.ts` had unconditional localhost/demo defaults. The real
`.env.production` was ignored by Git, and the Hosting jobs did not inject the
deployed settings. The old live site reproduced `http://localhost:8080/v1/me`
in Chromium.

The fix introduces an explicit `hosting-dev` Vite mode with versioned public
configuration. Staging/production require explicit environment variables.
Hosting modes ignore local `.env` files. Zod checks required settings, HTTPS,
project/domain consistency and disabled emulator configuration before bundling.
Local defaults remain only in development code and are removed from Hosting
bundles. No dependencies, contracts, database migrations or service changes
were introduced.

The output guard runs after building and again in Firebase's app predeploy hook.
It rejects missing Hosting metadata, absent configuration in executable JS,
local/emulator markers anywhere in output, and symlinks. Hosting source maps are
disabled. The only localhost exception is the exact React Router dummy-origin
expression for relative URL resolution without a window; extra localhost
strings still fail. Firebase SDK emulator-support code alone is not a configured
emulator endpoint.

An initial deployment exposed a Vite whole-object injection problem. It was
corrected to individual `import.meta.env.VITE_*` definitions, and the guard was
extended to reject configuration omitted from executable JavaScript. A built
page Chromium smoke check passed before the corrected second deployment. The
final live verification passed.

Files changed for this fix:

- `.github/workflows/ci.yml`, `deploy-environment.yml`, `deploy.yml`.
- `firebase.json` (app predeploy hook).
- `apps/somnus-app/hosting.dev.json`, `vite.config.ts`, `package.json`, `README.md`.
- `apps/somnus-app/src/config/env.ts`, `env-schema.ts`, `env-schema.test.ts`.
- `scripts/check-hosting-bundle.mjs`, `check-hosting-bundle.d.mts`.
- `tests/hosting-bundle.test.ts`.
- `docs/runbooks/deploy-dev.md`, `promotion-pipeline.md`, and this report.

Existing unrelated working-tree changes were preserved.

## Executed checks

Windows commands used the `.cmd` launchers because PowerShell script execution
is disabled. Vite/browser/cloud commands required sandbox escalation to access
parent directories, the network or existing CLI authentication. No automatic
approval rejection occurred.

| Command / verification | Actual result |
| --- | --- |
| `pnpm exec biome check` on the 10 changed JS/TS/JSON files | Exit 0, `Checked 10 files`, no fixes |
| `pnpm --filter @somnus/app typecheck` | Exit 0 |
| `pnpm --filter @somnus/app test:coverage` | Exit 0; 13 files, 65 tests passed |
| SPA coverage | Statements 92.98%, branches 72.5%, functions 95%, lines 95.23%; gates passed |
| `pnpm exec vitest run tests/hosting-bundle.test.ts` | Exit 0; 1 file, 21 tests passed |
| `pnpm --filter @somnus/app build:hosting --mode hosting-dev` | Exit 0; final build 6.59 s |
| Same build with `VITE_EDGE_API_URL=http://localhost:8080` | Exit 1; `Invalid Hosting configuration: VITE_EDGE_API_URL` |
| Actual final built JS deliberately injected with localhost URL | Guard exit 1 |
| Actual final built JS deliberately injected with `demo-api-key` | Guard exit 1 |
| Original final artifact restored after injection tests | Guard exit 0 |
| Chromium smoke check of built artifact | Login heading rendered, real edge URL requested, zero page errors; edge response mocked only for this local smoke check |
| `pnpm exec firebase deploy --only hosting:app --project the-somnuss --non-interactive` | Exit 0; `Hosting bundle guard passed.`, `Deploy complete!` |
| Final Chromium check of custom domain | Real edge GET 401, zero request failures/page errors, served bundle matches local SHA-256 |
| `pnpm run format:check` | Exit 1; existing `services/somnus-identity-service/migrations/meta/0003_snapshot.json` formatting error |
| `pnpm run lint` | Exit 1; 1 error, 15 warnings, 1 info; unused `PHASE_15_EVENT_TYPES` in existing `packages/api-contracts/src/events.ts:121` |
| `pnpm run typecheck` | Exit 0 |
| `pnpm run test:run` | Exit 1; 3 files failed / 32 passed; 10 tests failed / 322 passed |
| Root test failure cause | Existing admin browser tests collected by Node root runner: `sessionStorage`, `Storage`, `localStorage`, `document` undefined |
| `pnpm run build` | Exit 0 |
| `git diff --check` on the independently changed tracked source/workflow files | Exit 0 |

The full workspace quality gate is **not green**. Its unrelated failures were
reported rather than changing existing admin work or weakening tests. Python
and Docker checks were not applicable: no Python or Cloud Run service changed.

Build warning: the final JS chunk is **674.19 kB**, exceeding Vite's 500 kB
warning threshold (206.90 kB gzip). The limit was not changed.

Local evidence is under ignored `logs/hosting-fix/`: root gate logs,
`redeploy.log`, `rejected-build.log`, `injection-proof.json`,
`deployed-verification.json`, and `deployed-login.png`. A transient ECONNRESET
during an extra asset fetch was resolved by inspecting the browser's loaded
response; the final live check passed.

Vite configuration behavior was checked against its official
[environment documentation](https://vite.dev/guide/env-and-mode).
