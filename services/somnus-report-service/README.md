# somnus-report-service

The Somnus report service (build plan §5.6, Phase 11). Renders **approved,
versioned, localized** reports from a structured Morpheo payload: HTML now, PDF
via WeasyPrint, stored privately with short-lived signed URLs served through the
edge. Localized output in es, en, ca, fr.

**Boundary (§5.6):** it must never recalculate scores, alter safety flags,
create diagnoses, invent clinical facts, or prescribe treatments. The clinical
wording is Morpheo's approved content (§14a); this service only lays it out.

## Layout

`src/report/{main, api, infrastructure, schemas, settings}` — the same shell as
the morpheo Python template (Checkpoint 4.1). Owns the `somnus_reporting`
logical database (build plan §8).

## Develop

```bash
uv sync
uv run ruff check src tests && uv run mypy src && uv run pytest
uv run uvicorn report.main:app --reload
```

## Build plan

Implements build plan §5.6 / Phase 11 (Checkpoint 11.1 — deterministic rendering).
