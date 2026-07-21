# ADR 0005 — Python 3.x + FastAPI for Morpheo, data, and controlled AI

- Status: Accepted
- Date: 2026-07-21
- Phase: 1.2
- Decides: §3.5 (Python services), §3.6 (AI provider)

## Context

Morpheo's rule engine is pure deterministic Python. WeasyPrint and
data-processing tasks need an ecosystem Python provides natively. The
build plan forbids mixing the synchronous PyMySQL driver with an
async driver in the same codebase.

## Decision

Use **Python 3.13** (user-approved deviation to 3.14.3 on the local
machine, recorded in `docs/environment-baseline.md`) with **FastAPI**,
**Pydantic 2** + `pydantic-settings`, **SQLAlchemy 2.0** (synchronous
engine), **PyMySQL** as the only driver, **Alembic**, **pytest**,
**pytest-cov**, **Ruff**, **mypy**, **HTTPX**, and **uv** for
dependency management. Do **not** install pandas, numpy, ML libraries,
langchain, or notebooks. The **provider-abstraction module** sits
inside the report service (`infrastructure/llm/`) and exposes one
interface with provider adapters (OpenAI first; Vertex/Gemini may be
added later without changing business logic). GPT-5.6 is the primary
LLM; per §15 it may only rephrase approved structured results.

## Consequences

- One driver, one mental model, no async/sync impedance mismatch.
- Deterministic rule engine and report rendering in the same runtime.
- The AI provider swap is a config + adapter change, not a rewrite.
- LLM usage is bounded by §15; this is enforced in the report service
  and audited in the audit module.
