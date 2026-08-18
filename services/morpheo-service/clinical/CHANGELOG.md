# Morpheo clinical content changelog

Content-version bumps to the versioned artifacts (build plan §14a). The rule/
spec `workflow_version` changes only when rules, levels, or priorities change;
content-only additions bump `content_version` (reviewed by the Safety Committee).

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

### Wording flags raised for the clinical lead to confirm before this is permanent
- `sleepiness_near_miss`: contains the typo "dormirdo" (for "dormido"), loaded
  verbatim as provided.
- `new_neurological_deficit`: contains nested question marks ("…síntomas:
  ¿debilidad…? ¿dificultad…?"), loaded verbatim as provided.
