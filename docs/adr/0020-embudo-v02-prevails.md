# ADR 0020 — The embudo v0.2 is the Morpheo flow that prevails

- Status: Accepted (owner decision, 2026-10-18)
- Date: 2026-10-18
- Decides: §14, §14a (Morpheo source artifacts), §15 (AI), the claims registry
- Supersedes, where they conflict: `Morpheo_Algoritmos_Clinicos_y_Claims_v1.docx`,
  the 22 safety signals (`morpheo_safety_prompts_v1_es.json`), the L0-L4 safety
  levels, the CORE questions and the claims registry in
  `morpheo_workflows_v1.json` / `morpheo_claims_registry_v1.csv`

## Context

Morpheo was specified by `Morpheo_Algoritmos_Clinicos_y_Claims_v1.docx` and its
executable artifact `morpheo_workflows_v1.json`. On 17/10/2026 the clinical lead
delivered a new design, `services/morpheo-service/clinical/Morpheo_algoritmo_embudo_v02.pdf`
(15 pages, adults, footer "Propuesta pendiente de validación clínica",
SHA-256 `98beaab6a6d1d33bdc90cd13b23a17d18d86c08dde17d7c5ac036ccfac51caf1`).
It changes the questions, the order of the safety questions, the urgency model
and the role of the language model, and in places contradicts the earlier
documents.

Morpheo is for real adult patients who want help with their sleep: the person
using the app is the patient. Paediatrics is out of scope for now.

## Decision

**The embudo v0.2 is the flow that prevails.** Wherever it conflicts with an
earlier document, v0.2 wins:

- **Questions:** AGE, Q01-Q18, the branches I/R/H/D/P/N (fixed order
  I → R → H → D → P → N), S1-S4 and Z1-Z2 replace the CORE questions and the 27
  module questions of Algoritmos v1.
- **Safety:** S1-S4 and rule R01 replace the 22 safety signals. The routine block
  S1-S4 comes at the end (v0.2 pp. 9-10), with the cross-cutting exception: if a
  risk appears in any answer, act at that moment (pp. 1, 3, 9).
- **Urgency:** v0.2's categories and the R08 priority order (emergencia >
  evaluación prioritaria > consulta/estudio > terapia > hábitos) replace L0-L4.
- **AI:** the model extracts answers from the patient's free narrative and the
  patient confirms them (Z1) before any rule uses them; the rules live outside
  the language model; the final text comes from the v0.2 templates (p. 14).
- **Claims:** the templates T_INSOMNIO and T_PSG stay as written; the claims
  registry is updated to match v0.2, not the other way round.

Older documents still apply **only where v0.2 is silent**. Where v0.2 leaves a
term undefined, the implementation uses a conservative default (when in doubt,
the path that leads to a consultation rather than to self-help), marked
"DEFAULT – Jesús puede cambiarlo" in `docs/clinical/`.

## Consequences

- The next Morpheo content version is a breaking one (content_version 2.0,
  workflow_version 2.0): new questions, new rules, new result shape. Results
  frozen under content 1.x keep their L0-L4 level and must stay readable.
- The safety texts v1.2 are superseded: their pending written confirmation is no
  longer needed.
- `feat/morpheo-module-questions` (content 1.5, the 27 v1 questions) is frozen and
  will not be merged; reusable parts (stable ids, null ≠ false, answer storage,
  "Lo que nos has contado", the free-text identifier filter) are carried over.
- The claims registry, the forbidden-phrase list and the intended-purpose text
  must be changed in the same content release, so the scanner does not refuse
  v0.2's own templates. Proposing a test or a therapy to a patient moves Morpheo
  closer to a medical device (MDR Rule 11); that is a regulatory review item, not
  a reason to rewrite v0.2.
- Immutable negative tests that encode L0-L4 behaviour are not deleted: each one
  gets a v2.0 equivalent before the old engine is retired.
