# The Somnus Platform

Monorepo for **The Somnus** platform. The single source of truth is
[`THE_SOMNUS_PLATFORM_BUILD_PLAN.md`](./THE_SOMNUS_PLATFORM_BUILD_PLAN.md).
The companion prompt-by-prompt sequence lives in
[`THE_SOMNUS_PROMPT_PLAYBOOK.md`](./THE_SOMNUS_PROMPT_PLAYBOOK.md).
The build plan governs everything: if anything in code, library defaults,
or AI training knowledge conflicts with it, the build plan wins.

## Status

| Phase | Checkpoint | State |
|-------|------------|-------|
| 0     | 0.1 Environment baseline | **DONE** (see [`docs/environment-baseline.md`](./docs/environment-baseline.md)) |
| 1     | 1.1 Workspace and quality gate | **DONE** |
| 1     | 1.2 ADRs and CI | **DONE** |
| 2     | 2.1 config, errors, observability | **DONE** |
| 2     | 2.2 api-contracts, cloud-run-client, i18n, design-system | **DONE** |
| 3     | 3.1 NestJS template (identity shell) | **DONE** (see [`services/somnus-identity-service`](./services/somnus-identity-service)) |
| 4     | 4.1 Python template (Morpheo shell) | **DONE** (see [`services/morpheo-service`](./services/morpheo-service)) |
| 5     | 5.1 Terraform dev | **DONE** (see [`docs/runbooks/deploy-dev.md`](./docs/runbooks/deploy-dev.md)) |
| 6     | 6.1 Identity data layer | **DONE** (Drizzle schema, repositories, tenant-scope guard) |
| 6     | 6.2 Identity domain and API | **DONE** (contracts, authorization engine, endpoints; `sessions` stubbed until Phase 8) |
| 6     | 6.3 Negative authorization suite | **DONE** (10/10 scenarios green, marked immutable; CI wiring to the TiDB dev cluster still open, see [`services/somnus-identity-service` README](./services/somnus-identity-service/README.md#negative-authorization-suite-phase-63-immutable)) |
| 7+    | consent, edge API, frontends, Morpheo domain, report, worker, hardening | pending |

## Repository layout (per build plan §6)

```text
the-somnus-platform/
├── apps/                 (frontends: somnus-marketing, somnus-app)
├── services/             (Cloud Run services: edge-api, identity, morpheo, report, worker)
├── packages/             (shared: api-contracts, cloud-run-client, config, design-system, errors, i18n, observability, test-utils, tsconfig)
├── schemas/              (events/, json-schema/, openapi/)
├── infrastructure/       (terraform/)
├── docs/                 (adr/, api/, data/, runbooks/, security/)
├── scripts/              (developer scripts)
├── .github/workflows/    (CI)
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

All tools are listed in [`docs/environment-baseline.md`](./docs/environment-baseline.md).
On Windows, open a normal PowerShell (no admin required for `just` /
`pnpm`); the only steps that need elevation are the first install of
Docker Desktop and the first activation of a Corepack-pinned pnpm.

## Local development

```bash
# Start MySQL 8 + Firebase emulators
just dev-up

# Stop them
just dev-down

# Run the full quality gate locally (format check, lint, typecheck, tests, build)
just ci

# Reset the dev database and reseed (no seeds defined yet at Phase 1.1)
just seed
```

## Quality gate

The build plan (§23) requires the following to be green before any
checkpoint is considered done:

```bash
pnpm run lint
pnpm run typecheck
pnpm run test:run
pnpm run build
```

Biome handles formatting and linting. TypeScript strict mode is never
weakened. Vitest is the test runner for TypeScript code.

Python services (starting with `morpheo-service`, Phase 4) run their
own gate with `uv`, from the service directory:

```bash
uv run ruff format --check .
uv run ruff check .
uv run mypy src
uv run pytest
```

## Conventions

- Two static frontends on Firebase Hosting (Astro marketing, Vite+React SPA).
- Five Cloud Run services (edge-api, identity, morpheo, report, worker),
  all with `min-instances = 0`.
- Zod 4 is the single source of truth for API contracts; OpenAPI is
  generated, never hand-written.
- i18n: `es` (default), `en`, `ca`, `fr`. No hardcoded user-facing strings.
- Never log passwords, tokens, cookies, health data, or secrets.
- LLMs only rephrase approved structured results (§15).

See the build plan for the full ruleset.
