"""Entry gating (role/consent/age + professional privacy block)."""

from __future__ import annotations

from morpheo.application.gating import enforce_entry_gate
from morpheo.clinical.models import RoleId
from morpheo.domain.engine import AssessmentInput


def test_eligible_adult_with_consent_is_allowed() -> None:
    decision = enforce_entry_gate(
        AssessmentInput(role=RoleId.ADULT, age_years=30), consent_given=True
    )
    assert decision.allowed is True
    assert decision.reason is None


def test_missing_consent_is_blocked() -> None:
    decision = enforce_entry_gate(
        AssessmentInput(role=RoleId.ADULT, age_years=30), consent_given=False
    )
    assert decision.allowed is False
    assert decision.reason == "consent_required"


def test_ineligible_age_is_blocked() -> None:
    decision = enforce_entry_gate(
        AssessmentInput(role=RoleId.ADULT, age_years=15), consent_given=True
    )
    assert decision.allowed is False
    assert decision.reason == "ineligible"


def test_parent_requires_guardianship() -> None:
    ok = enforce_entry_gate(
        AssessmentInput(role=RoleId.PARENT, age_years=8, guardianship_confirmed=True),
        consent_given=True,
    )
    assert ok.allowed is True
    denied = enforce_entry_gate(
        AssessmentInput(role=RoleId.PARENT, age_years=8), consent_given=True
    )
    assert denied.allowed is False


def test_professional_identifiable_data_is_a_privacy_block() -> None:
    decision = enforce_entry_gate(
        AssessmentInput(
            role=RoleId.PROFESSIONAL,
            professional_confirmed=True,
            contains_identifiable_data=True,
        ),
        consent_given=True,
    )
    assert decision.allowed is False
    assert decision.privacy_block is True
    assert decision.reason == "privacy_block"
