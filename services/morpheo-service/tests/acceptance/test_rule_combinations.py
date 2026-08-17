"""Rule-combination proofs requested by the clinical lead (build plan §14a).

These are PROOF, not fixes: they validate two combinations against the safety
rules exactly as they exist today. They must never require a change to the
`when`, `priority`, or `level` of SAFE-001, SAFE-006, or SAFE-009.
"""

from __future__ import annotations

from morpheo.clinical.loader import load_clinical
from morpheo.clinical.models import RoleId, SafetyLevelId
from morpheo.domain.engine import AssessmentInput, run_assessment

BUNDLE = load_clinical()


def _run(**safety_answers: bool) -> object:
    return run_assessment(
        AssessmentInput(role=RoleId.ADULT, age_years=40, safety_answers=safety_answers),
        BUNDLE,
    )


def test_safe001_overrides_safe009_when_both_match() -> None:
    # unresponsive fires SAFE-001 (L0, pri 1000); sedative + breathing_concern
    # fire SAFE-009 (L2, pri 830). Both match, but the emergency must govern.
    result = _run(
        unresponsive=True,
        sedative_medication_or_substance=True,
        breathing_concern=True,
    )
    assert "SAFE-001" in result.triggered_rule_ids
    assert "SAFE-009" in result.triggered_rule_ids  # the L2 combination also matched
    assert result.triggered_rule_ids[0] == "SAFE-001"  # ...but SAFE-001 governs
    assert result.level is SafetyLevelId.L0  # never downgraded to L2
    assert result.stop is True


def test_safe006_does_not_fire_on_marked_sleepiness_alone() -> None:
    # SAFE-006 = witnessed_apneas AND (marked_sleepiness OR significant_deterioration).
    # marked_sleepiness alone, with witnessed_apneas false, must NOT trigger it.
    result = _run(marked_sleepiness=True, witnessed_apneas=False)
    assert "SAFE-006" not in result.triggered_rule_ids


def test_safe006_fires_on_witnessed_apneas_plus_marked_sleepiness() -> None:
    result = _run(witnessed_apneas=True, marked_sleepiness=True)
    assert "SAFE-006" in result.triggered_rule_ids
    assert result.level is SafetyLevelId.L1
