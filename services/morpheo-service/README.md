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
| `FUNNEL_V2_ENABLED` | `false` -- Morpheo v2.0, the embudo v0.2 engine (ADR 0020)   |
| `INSTRUMENTS_ENABLED` | `true` -- ISI, Epworth, STOP-Bang (D-34), see below        |
| `INSTRUMENTS_SOURCE_DIR` | unset -- `clinical/instruments/`; overridable for tests  |
| `AI_EXTRACTION_ENABLED` | `true` -- the AI of v0.2 p. 14, see below; needs a key      |
| `OPENAI_API_KEY` | empty -- no key, no model calls (every question is asked)     |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` (US); EU: `https://eu.api.openai.com/v1` |
| `AI_EXTRACTION_MODEL` | `gpt-6-luna`                                             |
| `AI_EXTRACTION_REASONING_EFFORT` / `AI_EXTRACTION_TEMPERATURE` | `none` / `0.0` |
| `AI_TIMEOUT_SECONDS` | `8` -- then the interview goes on without the model      |
| `PATIENT_DATA_ALLOWED` | `false` -- `true` refuses to start unless the EU endpoint |
| `AI_FIXTURE_FILE` | unset -- recorded outputs instead of OpenAI (dev/test only) |

### Validated instruments (ISI, Epworth, STOP-Bang)

`src/morpheo/instruments/` loads and scores them. Each is a versioned clinical
artifact in `clinical/instruments/`: the official validated Spanish text as
delivered with the licence (`<CODE>.official.txt`) and its structured
transcription (`<CODE>.json`: items, options, scoring, cut-offs, version,
licence source, the official text's SHA-256). At startup the loader checks the
SHA-256 and that every instruction, item, option and band label is word for
word in the official text; a file that fails stops the service. An instrument
whose file has not arrived is pending: the interview skips it and the team
panel says so. A score is a fact for the clinician; it never feeds the v0.2
rules. Format and placement: `clinical/instruments/README.md`.

### The AI (v0.2 p. 14: extraction and risk screen)

After the narrative (Q01) and every other free text (Q02, Q04's note, Q06,
Q10, Q14; Z2 is only screened), `src/morpheo/ai/` sends the text to the model
and the engine (`src/morpheo/funnel/extraction.py`, `ai_steps.py`) decides what
happens with the answer:

- **Extraction.** Candidate answers for Q01-Q18 and the branch questions, each
  with the person's exact words; Q14 broken down as p. 4 says (molestias,
  enfermedades, tratamientos, sustancias, ayudas probadas, and the flags the
  catalogue reads: bipolaridad, epilepsia, embarazo, opioides, sustancias,
  medicación). Strict JSON schema; anything out of schema, not among the
  question's options, or whose words are not literally in the text is
  discarded. Nothing inferred; a missing item is never "No", and the AI never
  proposes "ninguna" or an empty list.
- **Confirmation.** «Por lo que nos ha contado, entendemos: … ¿Es correcto?»
  right after the text: each item kept, corrected (with the question's own
  form) or removed. Only kept or corrected items reach the engine
  (`extraction.expand`); a removed one is asked in its turn. Z1 still shows
  everything.
- **Risk.** The classifier's "si" asks that safety question at that moment
  (the same key as the term list, so never twice); a failed call or a
  "dudoso" asks S1, S4 and S2 (if not yet asked) once per interview (DEFAULT).
  The AI adds questions, never alerts: only the person's answer raises one.
- **Final text.** Still templates and the catalogue only;
  `funnel/verify.py` refuses any paragraph with words from anywhere else.
- **Privacy and audit.** Names, places, centres, dates, phones, emails and
  DNI/NIE are pseudonymised locally (rules + spaCy `es_core_news_md`) and
  restored afterwards; `store=False`; one `ai.call` log event per call with
  hashes and counts only.
- **Resilience.** No key, flag off, timeout or any provider error: the
  interview never blocks and asks every question.

Tests never call a model: they replay `tests/fixtures/ai/recordings_v2.json`.

```bash
uv run python -m morpheo.ai.record --stand-in   # recordings from the gold labels (no model)
uv run python -m morpheo.ai.record              # real outputs: needs OPENAI_API_KEY (synthetic texts only)
uv run python -m morpheo.ai.quality             # precision/recall per field against the gold labels
uv run python -m morpheo.ai.narrative           # the 12 vignettes in narrative mode vs the full run
```

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

## Contenido clínico pendiente

Elementos señalados por el responsable clínico que **no** se implementan aún
porque dependen de contenido/decisiones nuevas, no de código. No tocar las
reglas afectadas hasta recibir el contenido aprobado:

- **SAFE-004 — criterios de escalado a L0.** Los casos graves de crisis
  nocturna o déficit neurológico (crisis > 5 min, crisis repetidas sin
  recuperación, lesión, o dificultad respiratoria durante el episodio)
  deberían escalar a L0, pero **no existe todavía una señal para ello**.
  Bloqueado a la espera de nuevas señales del responsable clínico; no inventar
  señales ni cambiar el nivel de SAFE-004.
- **SAFE-002 — vía de escalado humana.** La regla ya es L0 / prioridad 1000 /
  parada; lo pendiente es una **vía real de escalado a una persona** detrás del
  mensaje. Es una decisión de producto/operaciones, no un cambio de regla.

Ambos puntos están registrados en `clinical/CHANGELOG.md` (content_version 1.1).

## Build plan

Implements build plan §20 Phase 4 / Checkpoint 4.1.
