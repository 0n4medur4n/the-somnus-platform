"""Role / age / consent eligibility and the professional privacy block."""

from __future__ import annotations

from morpheo.clinical.models import RoleId
from morpheo.domain.engine import AssessmentInput, evaluate_eligibility


def test_adult_requires_age_18() -> None:
    assert evaluate_eligibility(AssessmentInput(role=RoleId.ADULT, age_years=18)).eligible
    assert not evaluate_eligibility(AssessmentInput(role=RoleId.ADULT, age_years=17)).eligible
    assert not evaluate_eligibility(AssessmentInput(role=RoleId.ADULT)).eligible


def test_parent_requires_guardianship_and_a_minor() -> None:
    ok = evaluate_eligibility(
        AssessmentInput(role=RoleId.PARENT, age_years=8, guardianship_confirmed=True)
    )
    assert ok.eligible
    # No guardianship confirmation.
    assert not evaluate_eligibility(AssessmentInput(role=RoleId.PARENT, age_years=8)).eligible
    # Subject is not a minor.
    assert not evaluate_eligibility(
        AssessmentInput(role=RoleId.PARENT, age_years=20, guardianship_confirmed=True)
    ).eligible


def test_professional_requires_confirmation() -> None:
    assert evaluate_eligibility(
        AssessmentInput(role=RoleId.PROFESSIONAL, professional_confirmed=True)
    ).eligible
    assert not evaluate_eligibility(AssessmentInput(role=RoleId.PROFESSIONAL)).eligible


def test_professional_identifiable_data_is_a_privacy_block() -> None:
    result = evaluate_eligibility(
        AssessmentInput(
            role=RoleId.PROFESSIONAL,
            professional_confirmed=True,
            contains_identifiable_data=True,
        )
    )
    assert result.privacy_block is True
