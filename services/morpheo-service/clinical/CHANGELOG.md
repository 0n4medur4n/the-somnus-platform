# Morpheo clinical content changelog

Content-version bumps to the versioned artifacts (build plan §14a). The rule/
spec `workflow_version` changes only when rules, levels, or priorities change;
content-only additions bump `content_version` (reviewed by the Safety Committee).

## content_version 2.1 — 2026-10-30 (rules 2.1): an interview no rule orients still says something

- Live test, 30/10/2026 (case FT-3): a finished interview in which no rule
  R01-R08 orients ended with no text, no report, an empty result page and a
  download link that answered 404. v0.2 has no outcome for that case.
- Owner decision, 30/10/2026: such an interview gets the new category
  `SIN_ORIENTACION` (last in the priority order, only when nothing else
  orients) and the text `T_SIN_ORIENTACION` in `morpheo_textos_v2.json`:
  it says no concrete orientation was found, that nothing is ruled out, and to
  consult a professional if sleep keeps affecting them. Status «APROBADO –
  decisión del titular, 30/10/2026; revisión de Jesús pendiente»; the loader
  accepts that status for this text only. Its report headline is its first two
  sentences (`morpheo_informe_v3.json`); no library source backs it.
- Only an interview stopped at the age (under 18, out of scope) still ends
  without text; the app shows its existing «only for adults» line and no
  download link instead of an empty page.

## content_version 2.0 — 2026-10-19 (rules 2.0): the embudo v0.2 is the active flow

- Owner and clinical lead, 19/10/2026: the v2 flow (`morpheo_embudo_v2.json`,
  the embudo v0.2) is the active flow of the app until the clinical lead says
  otherwise. The 1.x artifacts stay as they are, for the v1 flow behind
  `FUNNEL_V2_ENABLED=false` and for results already saved under 1.x.
- `morpheo_textos_v2.json` (renamed from `…_borrador.json`): the closed phrase
  catalogue for every template placeholder and the Z1 summary, and the new
  patient texts v0.2 gives only as instructions (safety actions SEG-S1/S4/S3,
  AVISO-S2, SEGURO-S2, PAUSA-S2, RECIENTE), approved by the clinical lead as
  they are on 19/10/2026. The loader refuses any list or text not marked
  approved.
- Instruments (D-34): ISI, Epworth and STOP-Bang are switched on; each is
  offered only once its official validated Spanish file is in
  `clinical/instruments/` (none yet). Placement: ISI at I6 (v0.2 p. 5);
  Epworth and STOP-Bang when branches D and R open (DEFAULT – Jesús puede
  cambiarlo).

## Standing rule — 2026-10-18 (ADR 0020)

- `Morpheo_algoritmo_embudo_v02.pdf` (17/10/2026, SHA-256
  `98beaab6a6d1d33bdc90cd13b23a17d18d86c08dde17d7c5ac036ccfac51caf1`) is the flow
  that prevails. It overrides `Morpheo_Algoritmos_Clinicos_y_Claims_v1.docx`, the
  22 safety signals, L0-L4, the CORE questions and the claims registry wherever
  they conflict; older documents apply only where v0.2 is silent. Its artifact
  will be content_version 2.0. Nothing in the 1.x artifacts changes with this
  entry.
- The written confirmation of the v1.2 safety texts (content 1.4) is no longer
  needed: those texts are superseded.

## content_version 1.4 — 2026-10-16 (workflow_version 1.0, unchanged)

- `morpheo_safety_prompts_v1_es.json` 1.1 → 1.2: the 22 safety questions keep
  the same clinical meaning and signal, but each audience now reads them in one
  consistent voice instead of a mix of "usted" and "la persona": the adult in
  "tú" about themselves, the parent/guardian about "tu hijo o hija", the
  professional about "la persona a la que valoras" (`question_by_role`;
  `question` stays as the default, adult wording). The two observer questions
  (`unresponsive`, `seizure_in_progress`) ask the adult whether someone *with
  them* is in that state, since a person in it cannot be answering. Typo fixed
  ("dormirdo"). No signal, rule, level or priority changes.

### Approval record
- Change requested by the product owner on 2026-10-16, stating that the clinical
  lead (Jesús) had approved rewording the questions. The final text above should
  still be read and confirmed by the clinical lead.

## content_version 1.3 — 2026-08-18 (workflow_version 1.0, unchanged)

- Expose `blockedClaims` (every BLOQUEAR claim statement) via the content
  endpoint so a consumer's forbidden-phrase scanner has the single governed
  source (build plan §15, Checkpoint 11.2 — controlled AI wording). No new
  clinical wording; the existing approved claims registry is surfaced as-is.

## content_version 1.2 — 2026-08-18 (workflow_version 1.0, unchanged)

- Limits section sourced from CLM-006/007/008 approved replacement text; removed
  duplicate string from report-service locales. The content endpoint now serves
  `limitsText` (three separate sentences, verbatim, es-only) so the report and
  any other consumer lay out a single governed source instead of their own copy.

## content_version 1.1 — 2026-08-17 (workflow_version 1.0, unchanged)

- Added `morpheo_safety_prompts_v1_es.json`: the 22 clinically-approved
  safety-signal questions (es), one per safety-rule signal atom, loaded verbatim
  and served through the content endpoint. Answer format Sí / No / No lo sé;
  "No lo sé" maps to unknown, never No (§14 unknown policy). The four pediatric
  questions (`minor_habitual_snoring`, `gasping`, `labored_breathing`,
  `daytime_behavior_learning_growth_concern`) are shown only under the
  parent/guardian role.
- SAFE-006 / SAFE-009 combination logic proof-tested per clinical lead review
  (no rule change): SAFE-001 (L0, priority 1000) overrides SAFE-009 (L2,
  priority 830) when both match; SAFE-006 requires `witnessed_apneas AND
  (marked_sleepiness OR significant_deterioration)`, not three independent
  triggers.
- Open items tracked separately, NOT changed here (see README "Contenido
  clínico pendiente"): SAFE-004 escalation criteria (blocked on new signals),
  SAFE-002 human escalation pathway (product/operations decision).

### Approval record
- `Morpheo_Preguntas_Seguridad_Respondidas.docx` is the clinical lead's approval
  of the 22 safety-signal questions above. The approved wording was loaded into
  `morpheo_safety_prompts_v1_es.json` directly in the session that added it; this
  file is the audit trail of that approval, not a source the service reads. It is
  kept here, with the artifacts it approves, rather than at the repository root.

### Wording flags raised for the clinical lead to confirm before this is permanent
- `sleepiness_near_miss`: contains the typo "dormirdo" (for "dormido"), loaded
  verbatim as provided.
- `new_neurological_deficit`: contains nested question marks ("…síntomas:
  ¿debilidad…? ¿dificultad…?"), loaded verbatim as provided.
