# Build progress and developer guide

This document holds what used to be the root `README.md` while the platform was
being built: the checkpoint-by-checkpoint status, the repository layout, the
local development commands and the quality gate. The root
[`README.md`](../README.md) now describes the company, the product and how the
platform works today.

The governing documents are unchanged, but three of them are now private (see
[Private repositories](#private-repositories)):

- `THE_SOMNUS_PLATFORM_BUILD_PLAN.md` is the single source of truth. If anything
  in code, library defaults or AI training knowledge conflicts with it, the
  build plan wins.
- `THE_SOMNUS_BUILD_PLAN_ADDENDUM_A.md` (registration flows, admin console,
  reference corpus) and `THE_SOMNUS_PROMPT_PLAYBOOK.md` (the prompt-by-prompt
  sequence).
- [`docs/adr/`](./adr/README.md) records the architecture decisions made since.

## Private repositories

The clinical content and the internal documents are not in this public
repository:

| Repository | Holds | Where it lands |
|---|---|---|
| `0n4medur4n/the-somnus-clinical` | The Morpheo clinical artifacts, with their changelog | Git submodule at `services/morpheo-service/clinical/` |
| `0n4medur4n/the-somnus-internal` | The build plan, addendum, playbook, `docs/security`, `docs/runbooks`, `docs/validation`, `docs/proposals`, `docs/clinical` | A local clone at `internal/` (git-ignored) |

```bash
git clone --recurse-submodules git@github.com:0n4medur4n/the-somnus-platform.git
# or, in an existing clone:
git submodule update --init
git clone git@github.com:0n4medur4n/the-somnus-internal.git internal
```

CI fetches the clinical submodule with a read-only deploy key
(`CLINICAL_DEPLOY_KEY`, composite action `.github/actions/fetch-clinical`).
Builds outside CI (Cloud Build from a clean worktree) must run
`git submodule update --init` first. A change to the clinical artifacts is two
commits: one in the clinical repository, then the submodule pointer here.

## Checkpoint status

Reconstructed from the git history on 2026-10-31. The commit log is the
authoritative record; each row names the build-plan checkpoint it closed.

| Phase | Checkpoint | State |
|-------|------------|-------|
| 0     | 0.1 Environment baseline | **DONE** (see [`environment-baseline.md`](./environment-baseline.md)) |
| 1     | 1.1 Workspace and quality gate | **DONE** |
| 1     | 1.2 ADRs and CI | **DONE** |
| 2     | 2.1 config, errors, observability | **DONE** |
| 2     | 2.2 api-contracts, cloud-run-client, i18n, design-system | **DONE** |
| 3     | 3.1 NestJS template (identity shell) | **DONE** (see [`services/somnus-identity-service`](../services/somnus-identity-service)) |
| 4     | 4.1 Python template (Morpheo shell) | **DONE** (see [`services/morpheo-service`](../services/morpheo-service)) |
| 5     | 5.1 Terraform dev | **DONE** (runbook `docs/runbooks/deploy-dev.md`, private) |
| 6     | 6.1 Identity data layer | **DONE** (Drizzle schema, repositories, tenant-scope guard) |
| 6     | 6.2 Identity domain and API | **DONE** (contracts, authorization engine, endpoints) |
| 6     | 6.3 Negative authorization suite | **DONE** (10/10 scenarios green, marked immutable; see the [identity README](../services/somnus-identity-service/README.md#negative-authorization-suite-phase-63-immutable)) |
| 7     | 7.1 Consent module | **DONE** (fully isolated: own database, migrations and repositories; reached only through `ConsentService`; see the [identity README](../services/somnus-identity-service/README.md#consent-module-phase-71-fully-isolated)) |
| 8     | 8.1 Edge API sessions and hardening | **DONE** (Firebase token verification, server-side sessions, CSRF, strict CORS, rate limiting, size limits) |
| 8     | 8.2 Edge API composition | **DONE** (internal OIDC clients, `/v1/me`, consent proxy) |
| 9     | 9.1 SPA foundation | **DONE** (`apps/somnus-app`, E2E and Lighthouse in CI) |
| 9     | 9.2 Marketing site | **DONE** (`apps/somnus-marketing`, Hosting deploy from CI) |
| 10    | 10.0 Load the clinical artifacts | **DONE** |
| 10    | 10.1 Rule engine and the twelve test cases | **DONE** |
| 10    | 10.2 Persistence, roles, anonymous flow | **DONE** |
| 10    | 10.3 Web integration | **DONE** |
| 11    | 11.1 Deterministic report rendering | **DONE** (HTML, PDF with WeasyPrint, private storage, signed URLs) |
| 11    | 11.2 Controlled AI wording | **DONE** (provider abstraction, OpenAI adapter, guardrails) |
| 11    | 11.3 Clinical grounding (RAG), explanation-only | **DONE** (determinism proof green) |
| 12    | 12.1 Notifications | **DONE** (Cloud Tasks consumer, Brevo, four locales) |
| 12    | 12.2 Audit and scheduled jobs | **DONE** (audit module, privacy-safe BigQuery export, retention jobs) |
| 13    | 13.1 Threat validation | **DONE** (`docs/security/threat-validation.md`, private) |
| 13    | 13.2 Compliance and operations | **DONE** (account erasure, DPIA, backup, incident and rollback runbooks) |
| 13    | 13.3 Staging, load, production readiness | **DONE** as code and runbooks; the open gaps are tracked in `docs/runbooks/production-readiness.md` (private) |
| 14    | Registration flows (Addendum A) | **DONE** |
| 15    | 15.1-15.5 Admin console (Addendum A) | **DONE** (gate, user management, review queue, dashboards and audit viewer, break-glass access) |
| 16    | 16.0-16.5 Reference corpus (Addendum B) | **DONE** (storage, rights gate, console, two-index retrieval, provenance) |

### Work beyond the original checkpoints

Decisions taken after the plan was written, each recorded as an ADR or in the
service changelogs:

- One GCP project per environment, with the API same-origin with each SPA
  ([ADR 0017](./adr/0017-one-project-per-environment.md)); profile photos in a
  private bucket ([ADR 0018](./adr/0018-profile-photos.md)).
- The staff Drive, end-to-end encrypted, in the worker
  ([ADR 0019](./adr/0019-staff-drive-end-to-end-encrypted.md)).
- The Morpheo v0.2 funnel as the interview that prevails over the earlier
  algorithm ([ADR 0020](./adr/0020-embudo-v02-prevails.md)); its content log is
  `services/morpheo-service/clinical/CHANGELOG.md` (private submodule).
- Morpheo invitations and administrative user detail
  ([ADR 0021](./adr/0021-morpheo-invitations-and-administrative-user-detail.md)).
- The one-page patient report and owner-authorised sources
  ([ADR 0022](./adr/0022-patient-report-and-owner-authorised-sources.md)).

## Repository layout (build plan §6)

```text
the-somnus-platform/
├── apps/                 (frontends: somnus-marketing, somnus-app, somnus-admin)
├── services/             (Cloud Run services: edge-api, identity, morpheo, report, worker)
├── packages/             (shared: api-contracts, cloud-run-client, config, design-system, errors, i18n, observability, test-utils, tsconfig)
├── schemas/              (events/, json-schema/, openapi/)
├── infrastructure/       (terraform/)
├── docs/                 (adr/, api/, data/)
├── scripts/              (developer and CI scripts)
├── .github/workflows/    (CI and deploy)
├── docker-compose.dev.yml
├── justfile
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── biome.json
├── vitest.config.ts
├── .nvmrc
├── .editorconfig
└── .gitignore
```

## Prerequisites

All tools are listed in [`environment-baseline.md`](./environment-baseline.md).
On Windows, open a normal PowerShell (no admin required for `just` / `pnpm`);
the only steps that need elevation are the first install of Docker Desktop and
the first activation of a Corepack-pinned pnpm.

## Local development

```bash
# Start MySQL 8 + Firebase emulators
just dev-up

# Stop them
just dev-down

# Run the full quality gate locally (format check, lint, typecheck, tests, build)
just ci

# Reset the dev database and reseed
just seed
```

## Quality gate

The build plan (§23) requires the following to be green before any checkpoint
is considered done:

```bash
pnpm run lint
pnpm run typecheck
pnpm run test:run
pnpm run build
```

Biome handles formatting and linting. TypeScript strict mode is never weakened.
Vitest is the test runner for TypeScript code.

Python services (`morpheo-service`, `somnus-report-service`) run their own gate
with `uv`, from the service directory:

```bash
uv run ruff format --check .
uv run ruff check .
uv run mypy src
uv run pytest
```

CI (`.github/workflows/ci.yml`) runs a job per deployable plus the workspace
quality gate, and a Docker build for every service image. Every job has to be
green, not only the one for the service that was touched.

## Conventions

- Static frontends on Firebase Hosting (Astro marketing, Vite + React SPAs).
- Five Cloud Run services (edge-api, identity, morpheo, report, worker), all
  with `min-instances = 0`.
- Zod 4 is the single source of truth for API contracts; OpenAPI is generated,
  never hand-written.
- i18n: `es` (default), `en`, `ca`, `fr`. No hardcoded user-facing strings.
- Never log passwords, tokens, cookies, health data, or secrets.
- Exception filters never maintain their own code→HTTP-status map; they always
  import `errorCodeToHttpStatus` from `@somnus/errors`. A new error code is
  wired once, there, and never copied into a filter.
- LLMs never score, flag, diagnose or decide urgency (§15).

See the build plan for the full ruleset.
