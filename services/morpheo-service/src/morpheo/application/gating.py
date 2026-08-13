"""Entry gating (build plan §14a state machine: ROLE_SELECTED -> CONSENT_OK).

Enforced before any assessment session is created: the role must be eligible
(age/consent/role, reusing the pure engine), consent must be given, and a
professional submitting identifiable data is blocked (T-12). Deterministic and
side-effect free.
"""

from __future__ import annotations

from dataclasses import dataclass

from morpheo.domain.engine import AssessmentInput, evaluate_eligibility


@dataclass(frozen=True)
class GateDecision:
    allowed: bool
    reason: str | None
    privacy_block: bool


def enforce_entry_gate(inp: AssessmentInput, *, consent_given: bool) -> GateDecision:
    eligibility = evaluate_eligibility(inp)
    if eligibility.privacy_block:
        return GateDecision(allowed=False, reason="privacy_block", privacy_block=True)
    if not consent_given:
        return GateDecision(allowed=False, reason="consent_required", privacy_block=False)
    if not eligibility.eligible:
        return GateDecision(allowed=False, reason="ineligible", privacy_block=False)
    return GateDecision(allowed=True, reason=None, privacy_block=False)
