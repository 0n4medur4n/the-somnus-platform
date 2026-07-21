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
pnpm --filter @somnus/identity-service test
```

The test suite includes:

- e2e tests for `/health/live`, `/health/ready`, `/version`,
  `x-correlation-id` propagation.
- `SomnusExceptionFilter` mapping (SomnusError → §16, unhandled → INTERNAL).
- `ZodValidationPipe` unit tests.
- `SomnusLogger` redaction test (tokens, stacks, and health fields
  never appear in log output; build plan §19).

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

Implements build plan §20 Phase 3 / Checkpoint 3.1.
