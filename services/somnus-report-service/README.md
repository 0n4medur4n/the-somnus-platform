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
- **Reescritura con IA (§15):** el LLM solo reformula prosa ya aprobada; nunca ve
  ni devuelve el nivel, los flags ni el enrutamiento (`application/rewriter.py`).
  Toda salida pasa por el escáner de frases prohibidas y queda `pending_review`.
- **Estado real del control (11.2):** el `Rewriter` **todavía no está cableado** a
  ningún endpoint ni al pipeline de render (`render_service`/`api/reports` no lo
  invocan); no se ejecuta en producción. `pending_review` existe hoy **solo como
  valor de estado** (retornado por `Rewriter.rewrite()` y registrado en el audit
  §15): **no hay** endpoint, UI de administración, rol/permiso ni persistencia que
  permita a una persona ver, aprobar o rechazar ese contenido. **No existe aún una
  puerta de revisión humana.**
- **Riesgo residual (DIFERIDO, no mitigado):** el escáner es *literal* (frases
  gobernadas + slots `[placeholder]`, sin distinción de mayúsculas); no atrapa una
  **paráfrasis** que evite la redacción exacta ni ofuscación Unicode/espacios. El
  escáner literal es el **único control automático** que existe hoy. La revisión
  humana que compensaría este hueco **está pendiente de un mecanismo que aún no se
  ha construido**; hasta que exista, la reescritura con IA no debe habilitarse en
  producción. Documentado y fijado por `tests/unit/test_rewriter.py`
  (`test_residual_risk_a_paraphrased_claim_is_not_caught...`) y por los cuatro
  vectores de inyección parametrizados en el mismo archivo.

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
