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
- **Reescritura con IA: mecanismo de revisión construido; el flag sigue off.**
  Checkpoint 15.3 cierra el diferido de 11.2. Existe ya una cola de revisión humana
  real: tabla `ai_content_review_items` en `somnus_reporting`, servicio de dominio
  (`application/content_review.py`), endpoints internos
  (`/internal/v1/admin/content-review/*`) y pantalla en la consola de administración
  restringida a `clinical_governance_reviewer` y `platform_super_admin` (§A2.2).
  **`AI_REWRITE_ENABLED` continúa en `default off`, y activarlo requiere una firma
  clínica explícita del responsable clínico después de haber usado esta cola** — no
  es una consecuencia de que el mecanismo exista, es una decisión aparte.
  El control sigue siendo estructural: `RenderService._finalize_html` es el único
  punto por donde la IA podría entrar al pipeline; con el flag off el `Rewriter`
  nunca se construye ni se invoca, y con el flag on **solo un ítem aprobado** hace
  elegible un candidato: la única pregunta que el pipeline puede hacerle a la cola
  ya lleva el filtro de estado dentro (`approved_candidate`), así que un ítem
  rechazado o pendiente no tiene ninguna ruta de salida. Fijado por
  `tests/unit/test_render_service.py`
  (`test_ai_rewrite_off_stores_the_deterministic_html_byte_for_byte`,
  `test_ai_rewrite_on_refuses_to_serve_unreviewed_output`) y por
  `tests/unit/test_content_review_render_gate.py`, que lo comprueba **a nivel de
  pipeline**: tras un render rechazado no queda ni un byte del candidato en storage.
- **El escáner corre antes de que el revisor vea nada.** Un candidato con una
  afirmación BLOQUEAR no llega a la cola como revisable: se escanea antes de
  persistir y se descarta con registro §15 (hashes, nunca prosa clínica). El
  revisor juzga redacción, no atrapa lo que un control automático ya prohíbe.
  Fijado por `tests/unit/test_content_review.py`.
- **Riesgo residual (diferido, no mitigado):** el escáner de frases prohibidas es
  *literal* (frases gobernadas + slots `[placeholder]`, sin distinción de
  mayúsculas); no atrapa una **paráfrasis** que evite la redacción exacta ni
  ofuscación Unicode/espacios, y es el **único control automático** que existe hoy.
  Como la IA está desactivada por flag, este hueco no es explotable en producción;
  se reevaluará cuando se construya el mecanismo de revisión. Documentado y fijado
  por `tests/unit/test_rewriter.py`
  (`test_residual_risk_a_paraphrased_claim_is_not_caught...`) y por los cuatro
  vectores de inyección parametrizados en el mismo archivo.
- **Grounding (§3.6b / §14b): solo explicativo, fuera de la ruta de decisión, y en
  dos capas con un orden de precedencia estricto.**

  **Por id, primero y normalmente la única.** §14b promete que el report recupera
  "la fuente clínica aprobada que la regla determinista ya citó". Eso significa
  que la cita la decide el **artefacto** vía `safety_rules[].sources`, no una
  búsqueda estadística. `CitationResolver` hace exactamente ese lookup: sin
  embedder, sin clave, sin red — así que la garantía de §14b se cumple también en
  entornos sin OpenAI configurado. El mapeo viaja desde el artefacto en
  `citedByRules` (respuesta `/internal/v1/clinical-sources` de morpheo) y se
  persiste en `clinical_sources.cited_by_rules`, versionado por `content_version`
  igual que la cita que selecciona.

  **Por similitud, solo cuando no hay nada que resolver.** Un informe puede no
  disparar ninguna regla (un L4 llano); ahí no existe fuente citada por regla y se
  mantiene el coseno sobre los nombres de módulo, sin cambios.

  Invertir ese orden era el defecto que cerró el Stage 4 de 11.3: con solo
  similitud, un informe que disparó SAFE-006 (cita SRC-02 y SRC-03) podía
  renderizarse citando SRC-01, porque su texto quedaba más cerca del nombre del
  módulo en el espacio de embeddings. Ni el nivel ni el enrutamiento estuvieron
  nunca en riesgo — la recuperación no los toca — pero la cita atribuía la decisión
  a evidencia que no la respaldaba. Fijado por
  `tests/unit/test_citation_resolution.py`, que demuestra el fallo y luego lo
  demuestra corregido.

  La recuperación
  **nunca cambia el nivel, el enrutamiento ni ninguna decisión**: alimenta solo esa
  sección, está **role-gated** (solo `professional`), consulta **solo términos
  aprobados** (nombres de módulo — nunca PII ni texto de salud), y **cualquier fallo
  degrada a sin citas** (`RenderService._citations`, guardado). Fijado por
  `tests/unit/test_render_determinism.py` (misma decisión con recuperación correcta,
  errónea, vacía o nula), `tests/unit/test_render_service.py`
  (`test_render_survives_a_failing_retriever...`, el caso que lanza) y
  `tests/unit/test_retrieval.py`. Los embeddings pasan por
  la abstracción de proveedor (sin llamadas directas al SDK) y se desactivan solos
  si no hay clave configurada.

## Indexación de las fuentes clínicas (Checkpoint 16.0)

`python -m report.jobs.index_sources` es la **única** vía por la que se embeben
las quince fuentes: un paso manual tras subir `content_version`, nunca en el
arranque (con mínimo de instancias a cero, el servicio arranca constantemente) y
nunca automático. Hasta 16.0 `SourceIndexer` no tenía ningún punto de entrada.

- **Idempotente** por `(content_version, src_id, text_hash)`: re-ejecutar una
  versión ya indexada hace **cero** llamadas de embedding y no escribe nada.
- **Una subida de versión cuesta solo lo que cambió**: una fuente con el mismo
  texto reutiliza el vector ya almacenado.
- **Nunca sobrescribe**: las versiones anteriores se conservan intactas, y el
  propio repositorio se niega a reemplazar un vector almacenado.
- **Todo o nada**, en una transacción; el aborto por recuento de Stage 3 sigue
  igual.
- **Rechaza** una versión indexada cuyo texto cambió sin subir `content_version`.

Procedimiento completo, requisitos y confirmación en
`docs/runbooks/deploy-dev.md`, sección *Indexing the clinical-source corpus*.

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
