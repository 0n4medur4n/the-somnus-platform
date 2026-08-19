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
- **Reescritura con IA: desactivada explícitamente.** La reescritura con IA está
  **desactivada vía `AI_REWRITE_ENABLED` (default off)** hasta que exista un
  mecanismo de revisión humana; **no debe activarse en ningún entorno hasta que ese
  mecanismo esté construido y revisado.** El control es estructural, no accidental:
  `RenderService._finalize_html` es el único punto por donde la IA podría entrar al
  pipeline; con el flag off el `Rewriter` nunca se construye ni se invoca, y con el
  flag on se rechaza servir salida sin revisar (§15). Fijado por
  `tests/unit/test_render_service.py`
  (`test_ai_rewrite_off_stores_the_deterministic_html_byte_for_byte`,
  `test_ai_rewrite_on_refuses_to_serve_unreviewed_output`). Hoy `pending_review`
  existe **solo como valor de estado**: no hay endpoint, UI, rol ni persistencia
  para aprobar/rechazar contenido — **no existe aún una puerta de revisión humana**.
- **Riesgo residual (diferido, no mitigado):** el escáner de frases prohibidas es
  *literal* (frases gobernadas + slots `[placeholder]`, sin distinción de
  mayúsculas); no atrapa una **paráfrasis** que evite la redacción exacta ni
  ofuscación Unicode/espacios, y es el **único control automático** que existe hoy.
  Como la IA está desactivada por flag, este hueco no es explotable en producción;
  se reevaluará cuando se construya el mecanismo de revisión. Documentado y fijado
  por `tests/unit/test_rewriter.py`
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
