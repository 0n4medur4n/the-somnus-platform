"""Input and result types for the pure rule engine (build plan §10.1).

Frozen dataclasses, no I/O: the engine is a pure function of its inputs and the
loaded artifacts, which is what gives the identical-input/identical-output
guarantee (§14b).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from morpheo.clinical.models import ModuleId, RoleId, SafetyLevelId

from .safety import SafetyOutcome


@dataclass(frozen=True)
class AssessmentInput:
    """A complete, structured set of answers for one deterministic evaluation.

    `safety_answers` maps safety-signal atom names (from the artifact's rule
    `when` conditions) to True / False / None(=unknown). `complaints` are the
    artifact's own `entry` phrases the patient reported. `base_orientation` is
    the non-urgent level (L3 scheduled / L4 information) decided by the profile;
    it applies only when no safety rule fires.
    """

    role: RoleId
    age_years: int | None = None
    guardianship_confirmed: bool | None = None
    professional_confirmed: bool | None = None
    contains_identifiable_data: bool = False
    complaints: frozenset[str] = frozenset()
    safety_answers: Mapping[str, bool | None] = field(default_factory=dict)
    base_orientation: SafetyLevelId = SafetyLevelId.L4

    def __post_init__(self) -> None:
        # L0/L1 are emergency/urgent and may only come from a safety rule; the
        # profile's non-urgent orientation is L2 (priority), L3 (scheduled), or
        # L4 (information/observation).
        if self.base_orientation in {SafetyLevelId.L0, SafetyLevelId.L1}:
            raise ValueError("base_orientation must be L2, L3, or L4 (non-urgent)")


@dataclass(frozen=True)
class AssessmentResult:
    role: RoleId
    eligible: bool
    privacy_block: bool
    routes: frozenset[ModuleId]
    safety: SafetyOutcome
    # Final urgency level: the safety level when a rule fired, else the profile's
    # non-urgent orientation. None when blocked or ineligible (nothing processed).
    level: SafetyLevelId | None
    stop: bool
    triggered_rule_ids: tuple[str, ...]
    workflow_version: str
    content_version: str
