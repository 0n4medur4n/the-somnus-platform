"""The result carries the content version, not the rules' version (§14a)."""

from __future__ import annotations

from morpheo.clinical.loader import load_clinical
from morpheo.clinical.models import RoleId, SafetyLevelId
from morpheo.domain.engine import AssessmentInput, run_assessment

BUNDLE = load_clinical()


def test_the_result_is_stamped_with_the_content_version() -> None:
    result = run_assessment(
        AssessmentInput(
            role=RoleId.ADULT,
            age_years=30,
            complaints=frozenset({"despertares"}),
            base_orientation=SafetyLevelId.L4,
        ),
        BUNDLE,
    )
    assert result.workflow_version == BUNDLE.workflows.meta.version
    assert result.content_version == BUNDLE.content_version
    # Today they differ (1.0 rules, 1.4 content): the stamp must say which content.
    assert BUNDLE.content_version != BUNDLE.workflows.meta.version


def test_an_ineligible_result_carries_the_content_version_too() -> None:
    result = run_assessment(AssessmentInput(role=RoleId.ADULT, age_years=15), BUNDLE)
    assert result.eligible is False
    assert result.content_version == BUNDLE.content_version
