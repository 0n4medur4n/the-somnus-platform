"""Role / age / consent eligibility (build plan §11 / §14a).

adult: age >= 18. parent/guardian: guardianship confirmed AND the minor is
under 18 (the minor never converses directly). professional: professional
confirmation; identifiable data is blocked in the beta (T-12) — the assessment
is not processed.
"""

from __future__ import annotations

from dataclasses import dataclass

from morpheo.clinical.models import RoleId

from .models import AssessmentInput


@dataclass(frozen=True)
class Eligibility:
    eligible: bool
    privacy_block: bool


def evaluate_eligibility(inp: AssessmentInput) -> Eligibility:
    if inp.role is RoleId.PROFESSIONAL:
        if inp.contains_identifiable_data:
            # Eligible as a professional, but the input is blocked for privacy:
            # anonymize before processing (T-12).
            return Eligibility(eligible=True, privacy_block=True)
        return Eligibility(eligible=inp.professional_confirmed is True, privacy_block=False)

    if inp.role is RoleId.ADULT:
        is_adult = inp.age_years is not None and inp.age_years >= 18
        return Eligibility(eligible=is_adult, privacy_block=False)

    # parent/guardian: guardianship confirmed AND a minor subject
    is_minor = inp.age_years is not None and inp.age_years < 18
    return Eligibility(
        eligible=inp.guardianship_confirmed is True and is_minor,
        privacy_block=False,
    )
