# somnus-report-service

The Somnus report service (build plan §5.6, Phase 11). Renders **approved,
versioned, localized** reports from a structured Morpheo payload: HTML now, PDF
via WeasyPrint, stored privately with short-lived signed URLs served through the
edge. Localized output in es, en, ca, fr.

**Boundary (§5.6):** it must never recalculate scores, alter safety flags,
create diagnoses, invent clinical facts, or prescribe treatments. The clinical
wording is Morpheo's approved content (§14a); this service only lays it out.

## Gobernanza clínica

- **El aviso de emergencia solo se activa por `level == "L0"` proveniente de
  Morpheo; ninguna otra señal debe dispararlo** (ni un flag, ni `stop`, ni un
  escaneo de texto, ni una heurística) — condición confirmada por el responsable
  clínico. Enforzado por `tests/unit/test_renderer.py`
  (`test_emergency_notice_never_triggers_below_l0` / `..._triggers_only_on_l0`).
- **Los límites** ("Límites") se sirven desde Morpheo (`limitsText`, texto de
  reemplazo aprobado de CLM-006/007/008), no desde los locales del report. El
  report no redacta ese texto; lo maqueta verbatim.
- El marco *"Con la información disponible…"* sí es propio del report (requisito
  de presentación §14b), no contenido clínico por caso.

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
