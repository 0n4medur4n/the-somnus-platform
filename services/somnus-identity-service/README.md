# somnus-identity-service

The reference NestJS service for the Somnus platform. This service is
the **template** that every other Cloud Run service is cloned from
(edge-api, morpheo, report, worker). It contains the common runtime:
Fastify + helmet, structured JSON logging via `@somnus/observability`,
correlation ID propagation, Zod validation, the §16 error response
shape, the `SomnusExceptionFilter`, the OpenAPI generator, and a
multi-stage non-root Dockerfile.

## Endpoints (Phase 3.1)

| Method | Path           | Description                                    |
|--------|----------------|------------------------------------------------|
| GET    | `/health/live` | Liveness probe. Always 200 if the process up.  |
| GET    | `/health/ready`| Readiness probe. 200 when ready to serve.      |
| GET    | `/version`     | Service identity (service, version, commit…). |
| GET    | `/docs`        | Swagger UI for the generated OpenAPI doc.      |

## Identity domain and API (Phase 6.2)

| Method | Path                                              | Description                                             |
|--------|----------------------------------------------------|----------------------------------------------------------|
| POST   | `/internal/v1/authorization/check`                 | The single authorization decision point (build plan §11). Internal-only, never routed by edge-api. |
| GET    | `/v1/me`                                           | The actor's user record + individual/professional profile. |
| PATCH  | `/v1/me/profile`                                   | Patch the actor's own individual profile.                |
| POST   | `/v1/organizations`                                | Create an organization; creator becomes its owner.        |
| GET    | `/v1/organizations/:organizationId`                | Read an organization by id.                               |
| PATCH  | `/v1/organizations/:organizationId`                | Update name/status. Requires an active admin/owner membership. |
| GET    | `/v1/organizations/:organizationId/members`        | List members. Requires active membership.                 |
| PATCH  | `/v1/organizations/:organizationId/members/:membershipId` | Patch a member's status. Requires an active admin/owner membership. |
| POST   | `/v1/organizations/:organizationId/invitations`    | Invite a member. Requires an active admin/owner membership. |
| POST   | `/v1/invitations/accept`                           | Accept an invitation by its single-use token.              |
| POST   | `/v1/me/professional/verification-cases`           | Open a verification case for the actor's own professional profile. |
| GET    | `/v1/me/professional/verification-cases`           | List the actor's own verification cases.                   |
| POST   | `/v1/me/access-grants`                             | Grant a professional access to the actor's own data.        |
| GET    | `/v1/me/access-grants`                             | List the actor's own active access grants.                  |
| POST   | `/v1/me/access-grants/:grantId/revoke`             | Revoke a grant the actor previously issued.                 |

`sessions` endpoints remain stubs until Phase 8 (edge-api's real Firebase
auth). Until then, every request carries the trust-boundary header
`x-somnus-actor-id` (`CurrentActorId` decorator,
`src/common/decorators/current-actor.decorator.ts`) instead of a
verified token -- safe only because this service is Cloud-Run-private
with IAM-restricted invoker access (Terraform Checkpoint 5.1); edge-api
is the only allowed caller and is responsible for verifying the real
Firebase token before setting this header.

### Authorization engine

`src/domain/authorization/authorization-policy.ts` is a pure function,
`evaluateAccess(input): AuthorizationDecision`, with zero framework or
DB dependencies (mirrors the pattern the build plan mandates for
Morpheo's future rule engine, Phase 10.1). It is the only place build
plan §11's access rules are encoded, and is unit-tested for every one
of the 14 `AUTHORIZATION_REASON_CODES` (100% line/branch coverage).
`src/domain/authorization/authorization.service.ts` is the thin,
impure shell around it: it resolves facts (actor status, role
assignments, membership, verification status, access grants) from the
Checkpoint 6.1 repositories, then hands off to the pure policy.
`POST /internal/v1/authorization/check` is the only HTTP entry point;
every other service in the platform that needs an authorization
decision is meant to call it rather than re-implementing §11 locally.

### DTOs and OpenAPI generation

Every request body is validated by a `createZodDto(...)`-derived class
(`nestjs-zod`, `src/common/dto/identity.dto.ts`) wired through a
*global* `ZodValidationPipe` (`APP_PIPE` in `app.module.ts`) rather than
per-route pipes -- a per-route/per-parameter `@UsePipes()` was tried
first and rejected because it validates every decorated parameter
(including `@CurrentActorId()`), not just `@Body()`.

**Constructor-injected classes and `@Body()` DTO classes must be
imported as real (value) imports, never `import type`.** NestJS's DI
and nestjs-zod's pipe both rely on `emitDecoratorMetadata`'s
`design:paramtypes`, which only contains a usable class reference when
the class was imported as a value; a type-only import is elided at
compile time and the metadata silently degrades to `Object`, breaking
DI resolution and (more dangerously) silently skipping request
validation. Biome's `useImportType` rule cannot know about this
runtime requirement, so every such import carries a `biome-ignore
lint/style/useImportType` comment explaining why -- this is enforced
manually, not by a lint override, so the exception stays visible and
auditable per-line rather than weakening the rule.

OpenAPI is regenerated with `pnpm --filter @somnus/identity-service
generate:openapi`, which must run through `@swc-node/register`
(`node --import @swc-node/register/esm-register scripts/generate-openapi.ts`,
already wired into the script) rather than the default `tsx`: `tsx` is
esbuild-based and does not support `emitDecoratorMetadata`, which
silently produces empty request-body schemas.

### Reference data migration

`migrations/0001_seed_platform_roles.sql` seeds the 11-role catalog
from build plan §11 with fixed, pre-generated UUIDv7 ids. This is
permanent reference data applied via a real migration (not
`scripts/seed-dev.ts`'s dev-fixture concern), and is excluded from the
test suite's `resetTables()` truncation between tests.

## Negative authorization suite (Phase 6.3, IMMUTABLE)

`test/integration/negative-authorization.immutable.test.ts` is the
platform's authorization safety net -- build plan §20 Checkpoint 6.3's
ten named scenarios, each its own test, run against the real app and a
real database:

1. org admin cannot read clinical data automatically
2. inactive professional denied
3. unverified professional denied where verification required
4. expired (inactive) membership denied
5. revoked grant denied
6. cross-organization member access denied
7. self-assignment of privileged roles denied (parametrized across
   every key in `INTERNAL_ROLE_KEYS`)
8. support staff denied health data by default
9. invitation token single-use
10. deleted/suspended user cannot create a session (tested at the
    authorization layer -- `sessions` endpoints are still stubs until
    Phase 8, so `DENIED_ACTOR_ACCOUNT_INACTIVE` is the honest,
    currently-testable proxy for the gate a real session-creation flow
    will depend on)

**This file must never be weakened, skipped, or deleted to make an
unrelated change pass.** If a source change breaks one of the ten, the
source change is wrong. If build plan §11 itself changes, the rewrite
of this file belongs in the same PR as that amendment, reviewed as a
security-relevant change. It intentionally does not share helpers with
other test files, so an edit to `http-endpoints.integration.test.ts`
can never silently change what this suite actually exercises.

Building this suite required closing a real gap discovered while
writing it: `POST /v1/organizations/:organizationId/invitations`
accepted any of the 11 role keys in `roleKey`, including internal/
platform roles (`support_agent`, `professional_verifier`,
`clinical_governance_reviewer`, `platform_admin`,
`platform_super_admin`) -- any org admin could grant themselves or an
accomplice a privileged internal role through the public invitation
endpoint. `InvitationsService.create` now rejects any `roleKey` in
`INTERNAL_ROLE_KEYS` with `403 FORBIDDEN` before creating the
invitation.

**CI protection:** `.github/workflows/ci.yml` has an `identity-service`
job that runs `pnpm --filter @somnus/identity-service test:coverage`
(the full suite, including this file, with coverage thresholds
enforced) against the TiDB Cloud dev cluster on every push and pull
request to `main`. It uses a dedicated concurrency group
(`identity-service-tidb-dev`, `cancel-in-progress: false`) so two PRs'
runs queue instead of racing -- the cluster is a single shared external
resource, and this suite's `resetTables()` would otherwise let one run
truncate another's in-flight data. The migration + full test run
(including this suite) has been verified end to end against the real
cluster, not just against local docker-compose MySQL. The job reads
its connection string from the `TIDB_DEV_DATABASE_URL` repository
secret and sets `DB_SSL=true` so `db.client.ts` negotiates TLS (see
`DbConfigSchema`'s `DB_SSL` field, off by default for local dev, since
docker-compose MySQL doesn't speak TLS at all) -- this only becomes a
live required check once that secret is present in the repo's Actions
secrets (Settings -> Secrets and variables -> Actions).

## Data layer (Phase 6.1)

Drizzle ORM + `mysql2` against `somnus_identity` (build plan §3.4,
§12). All 19 identity tables, UUIDv7 primary keys everywhere,
app-generated (never DB auto-increment) via `@somnus/api-contracts`'
`UUIDv7()`. No `.references()` foreign-key constraints -- see the
comment at the top of `src/infrastructure/db/schema/index.ts` for why
(TiDB Cloud, referential integrity enforced by the repository layer).

### Tenant scoping

Build plan §8: *"Every tenant-aware repository method receives an
organization or user scope."*

```typescript
findMembership({ organizationId, membershipId });   // correct
findMembershipById(membershipId);                    // forbidden for tenant data
```

Enforced two ways (`src/infrastructure/db/tenant-scope.ts`):

1. **Compile-time**: every tenant-sensitive repository method's scope
   argument is a required, named `scope: OrgScope | UserScope`
   parameter. Omitting it is a TypeScript error at the call site.
2. **Runtime guard**: `test/architecture/tenant-scope-guard.test.ts`
   scans every file in `src/infrastructure/db/repositories/` and fails
   if any method that queries a tenant-scoped table lacks a `scope`
   parameter. Two deliberate, documented exceptions exist (invitation
   token lookup/accept -- the single-use token itself is the
   authorization mechanism there, not an org id); the test also
   asserts those exceptions haven't gone stale.

### Configuration

| Env var | Default (local dev) |
|---|---|
| `DATABASE_URL` | `mysql://root:rootpw@127.0.0.1:3306/somnus_identity` |
| `DB_POOL_SIZE` | `5` (ceiling only -- `mysql2` pools do not eagerly open connections, build plan §2) |

### Migrations

```bash
# Regenerate SQL from the Drizzle schema after a schema change
pnpm --filter @somnus/identity-service db:generate

# Inspect the schema visually (drizzle-kit studio)
pnpm --filter @somnus/identity-service db:studio
```

Every migration ships with a hand-maintained `<name>.down.sql` next to
the generated `<name>.sql` (build plan §8 rollback policy: drizzle-kit
only generates "up" SQL). `src/infrastructure/db/migrate.ts` exports
`runMigrationsUp`/`runMigrationsDown`; the down path also drops
Drizzle's own `__drizzle_migrations` tracking table so a later "up" is
treated as fresh rather than silently skipped.

## Local development

```bash
# 1) Install deps (at the repo root)
pnpm install

# 2) Start the local stack (MySQL 8 + Firebase emulators)
just dev-up

# 3) Run the service in watch mode
pnpm --filter @somnus/identity-service start:dev

# 4) Smoke
curl http://localhost:8080/health/live
curl http://localhost:8080/version
```

## Quality gate

```bash
# Requires `just dev-up` running (MySQL 8 on localhost:3306)
pnpm --filter @somnus/identity-service test
pnpm --filter @somnus/identity-service test:coverage
```

The test suite includes:

- e2e tests for `/health/live`, `/health/ready`, `/version`,
  `x-correlation-id` propagation.
- `SomnusExceptionFilter` mapping (SomnusError → §16, unhandled → INTERNAL).
- `ZodValidationPipe` unit tests.
- `SomnusLogger` redaction test (tokens, stacks, and health fields
  never appear in log output; build plan §19).
- Migration up/down/up integration test against real MySQL
  (`test/integration/migrations.integration.test.ts`).
- Repository integration tests per aggregate (users, profiles,
  organizations, memberships, invitations, roles, role assignments,
  access grants, audit) -- each asserting both the happy path and that
  scoping actually filters cross-tenant data, not just that the
  parameter is accepted.
- The tenant-scope guard (`test/architecture/tenant-scope-guard.test.ts`).
- Authorization policy unit tests, one per `reasonCode`
  (`test/unit/authorization-policy.test.ts`, 100% coverage on
  `src/domain/**`).
- `AppModule` bootstrap test (`test/integration/app-module-bootstrap.integration.test.ts`)
  -- compiles the real DI graph end-to-end so a missing/misconfigured
  provider (e.g. a constructor-injected class accidentally imported as
  `import type`) fails the suite instead of only surfacing at deploy time.
- HTTP e2e tests for every Checkpoint 6.2 endpoint
  (`test/integration/http-endpoints.integration.test.ts`), via Fastify's
  `server.inject()` against the real app + real MySQL.
- Contract tests against the generated OpenAPI document
  (`test/contract/openapi.contract.test.ts`): every route is asserted
  present with the right method and request-schema reference, and every
  request DTO's generated JSON Schema is checked to accept/reject the
  same payloads as its source-of-truth Zod schema.

A global vitest setup (`test/global-setup.ts`) applies migrations once
before the suite runs; `fileParallelism: false` keeps the migration
up/down test from racing repository tests against the same live
database.

## OpenAPI generation

Per build plan §3.4, OpenAPI is generated from Zod, never
hand-written. To regenerate the document:

```bash
pnpm --filter @somnus/identity-service generate:openapi
# Writes schemas/openapi/identity-service.json
```

## Docker

The Dockerfile is multi-stage, runs as the non-root `somnus` user,
and uses the slim `node:24-alpine` runtime. Build:

```bash
docker build -t somnus-identity-service:dev \
  -f services/somnus-identity-service/Dockerfile .
```

## Cloning the template

To create a new service from this one (e.g. `somnus-worker`):

1. Copy the directory: `cp -R services/somnus-identity-service services/somnus-worker`
2. Replace every occurrence of `somnus-identity-service` with
   `somnus-worker` in: `package.json`, `Dockerfile`,
   `scripts/generate-openapi.ts`, `src/main.ts`, `src/app.module.ts`.
3. Replace `SERVICE_NAME` in the version controller.
4. Add the new service to `pnpm-workspace.yaml` (already covers
   `services/*`, so nothing to do there) and to the root `package.json`
   scripts if you want a top-level command.
5. Drop the new OpenAPI under `schemas/openapi/<service>.json`.

## Build plan

Implements build plan §20 Phase 3 / Checkpoint 3.1 (service shell),
Phase 6 / Checkpoint 6.1 (identity data layer), and Phase 6 /
Checkpoint 6.2 (identity domain and API: contracts, the authorization
engine, and every endpoint except `sessions`, stubbed until Phase 8).
