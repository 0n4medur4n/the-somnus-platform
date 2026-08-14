"""Edge <-> morpheo boundary DTOs (build plan §20 Checkpoint 10.2 / §19).

These Pydantic models are the Python side of the edge <-> morpheo contract
whose single source of truth is the Zod schema in
`packages/api-contracts/src/morpheo`. The generated JSON Schema under
`schemas/json-schema/morpheo/` is validated against these DTOs by the contract
test, so a drift on either side fails CI. Field names are snake_case in Python
and serialized as camelCase (`by_alias=True`) to match the wire contract.

No HTTP routing lives here — that is Checkpoint 10.3's web integration. These
are only the contract binding + the mapping from the engine's `AssessmentResult`.
"""

from __future__ import annotations

from typing import Literal

from morpheo.clinical.models import ModuleId, RoleId, SafetyLevelId
from morpheo.domain.engine import AssessmentResult
from morpheo.schemas.base import ContractModel as _ContractModel

GateReason = Literal["privacy_block", "consent_required", "ineligible"]
ClaimRejectReason = Literal["already_claimed_or_expired"]
AnswerKind = Literal["complaint", "signal"]
TernaryValue = Literal["true", "false", "unknown"]
BaseOrientation = Literal["L2", "L3", "L4"]


class AssessmentCreateRequestDTO(_ContractModel):
    role: RoleId
    consent_given: bool
    age_years: int | None = None
    guardianship_confirmed: bool | None = None
    professional_confirmed: bool | None = None
    contains_identifiable_data: bool = False
    base_orientation: BaseOrientation = "L4"


class AssessmentCreateResponseDTO(_ContractModel):
    allowed: bool
    session_id: str | None
    reason: GateReason | None


class AnswerSubmitRequestDTO(_ContractModel):
    kind: AnswerKind
    name: str
    value: TernaryValue | None = None


class AssessmentResultDTO(_ContractModel):
    role: RoleId
    level: SafetyLevelId | None
    stop: bool
    privacy_block: bool
    routes: list[ModuleId]
    triggered_rules: list[str]
    workflow_version: str
    content_version: str

    @classmethod
    def from_result(cls, result: AssessmentResult) -> AssessmentResultDTO:
        return cls(
            role=result.role,
            level=result.level,
            stop=result.stop,
            privacy_block=result.privacy_block,
            routes=sorted(result.routes, key=lambda module: module.value),
            triggered_rules=list(result.triggered_rule_ids),
            workflow_version=result.workflow_version,
            content_version=result.content_version,
        )


class AssessmentClaimRequestDTO(_ContractModel):
    token: str


class AssessmentClaimTokenResponseDTO(_ContractModel):
    token: str


class AssessmentClaimResponseDTO(_ContractModel):
    success: bool
    snapshot_id: str | None
    reason: ClaimRejectReason | None


class AssessmentSnapshotResponseDTO(_ContractModel):
    snapshot_id: str
    session_id: str
    result: AssessmentResultDTO
    workflow_version: str
    content_version: str
