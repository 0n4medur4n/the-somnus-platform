# morpheo-service

The reference Python service for The Somnus platform. This service is
the **template** every other Python Cloud Run service clones from
(starting with `somnus-report-service`). It contains the common
runtime: FastAPI, structured JSON logging, correlation-ID propagation,
the §16 error response shape for unhandled exceptions, health/version
endpoints, Alembic wired against `somnus_morpheo`, and a multi-stage
non-root Dockerfile.

At this checkpoint (build plan §20 Phase 4 / Checkpoint 4.1) there is
**no assessment logic**: `domain/`, `application/`, `repositories/`,
and `schemas/` are placeholders that establish the package layout and
testing pattern Phase 10 will fill in.

## Python version note

The build plan pins Python 3.13 (§3.5). `docs/environment-baseline.md`
recorded 3.14.3 as a user-approved deviation because 3.13 wasn't
available via winget at the time. For this service we instead used
`uv python install 3.13`, which fetches a standalone CPython 3.13.14
build with no admin rights required — so `morpheo-service` runs on the
build-plan-pinned version with no deviation. `.python-version` in this
directory pins it explicitly.

## Endpoints (Phase 4.1)

| Method | Path           | Description                                    |
|--------|----------------|------------------------------------------------|
| GET    | `/health/live` | Liveness probe. Always 200 if the process is up. |
| GET    | `/health/ready`| Readiness probe. 200 when ready to serve.      |
| GET    | `/version`     | Service identity (service, version, commit, env, python). |
| GET    | `/docs`        | Swagger UI (FastAPI's built-in OpenAPI docs).  |

## Configuration

Settings are validated at startup (`src/morpheo/settings/config.py`);
invalid values fail fast with a readable message instead of booting
half-configured. The env-var names mirror `packages/config`'s Zod
schema so the same vocabulary works across the NestJS and Python
fleets:

| Env var         | Default (local dev)                                         |
|-----------------|---------------------------------------------------------------|
| `SERVICE_NAME`  | `morpheo-service`                                              |
| `SERVICE_VERSION` | `0.0.0`                                                      |
| `SERVICE_COMMIT`  | `local`                                                      |
| `ENV`           | `development`                                                  |
| `PORT`          | `8080`                                                          |
| `LOG_LEVEL`     | `info`                                                          |
| `LOG_FORMAT`    | `json`                                                          |
| `DATABASE_URL`  | `mysql+pymysql://root:rootpw@127.0.0.1:3306/somnus_morpheo`     |

## Local development

```bash
# 1) Start the local stack (MySQL 8 + Firebase emulators) from the repo root
just dev-up

# 2) Install deps (uv manages its own virtualenv under .venv)
cd services/morpheo-service
uv sync

# 3) Run the service in watch mode
uv run uvicorn morpheo.main:app --reload --port 8080

# 4) Smoke
curl http://localhost:8080/health/live
curl http://localhost:8080/version
```

## Quality gate

```bash
uv run ruff format --check .
uv run ruff check .
uv run mypy src
uv run pytest
```

The test suite includes:

- integration tests for `/health/live`, `/health/ready`, `/version`,
  and `x-correlation-id` propagation (generated, echoed, replaced when
  malformed).
- an integration test proving unhandled exceptions never leak a stack
  trace or exception text to the client in `production`, while still
  surfacing detail in non-production environments (both map to the
  §16 error shape).
- a settings validation-failure test (invalid port, env, log level,
  log format, empty service name all rejected).
- a placeholder pure-function test establishing the `domain/` testing
  pattern that Phase 10's rule engine will follow.

## Migrations (Alembic → `somnus_morpheo`)

```bash
# Apply all migrations locally (requires `just dev-up` running)
uv run alembic upgrade head

# Roll back
uv run alembic downgrade base

# Create a new revision
uv run alembic revision -m "add assessment_definitions"
```

The initial revision is intentionally empty — it only proves the
Alembic + SQLAlchemy (sync) + PyMySQL wiring works end-to-end. Real
tables land in Phase 10.2 per build plan §14. Every migration must be
reversible, or explicitly documented as irreversible with a stated
recovery path (build plan §8).

## Docker

Multi-stage, runs as the non-root `somnus` user, `python:3.13-slim`
runtime, dependencies installed non-editable via `uv sync --no-editable`
so the runtime stage only needs the resulting `.venv`. Build:

```bash
docker build -t morpheo-service:dev -f services/morpheo-service/Dockerfile .
```

## Cloning the template

To create a new Python service from this one (e.g.
`somnus-report-service`):

1. Copy the directory: `cp -R services/morpheo-service services/somnus-report-service`
2. Update `pyproject.toml`: `name`, `description`.
3. Rename the package: `src/morpheo` → `src/<new_package>`, and update
   every import (`api/`, `main.py`, `migrations/env.py`).
4. Update `SERVICE_NAME` in `src/<new_package>/settings/config.py`'s
   default and in the Dockerfile's `ENV SERVICE_NAME=...`.
5. Point `DATABASE_URL`'s default at the new service's logical database
   (build plan §3.9) and re-run `alembic init` if starting migrations
   fresh, or keep the empty-migration pattern.
6. Regenerate `uv.lock`: `uv lock`.

## Build plan

Implements build plan §20 Phase 4 / Checkpoint 4.1.
