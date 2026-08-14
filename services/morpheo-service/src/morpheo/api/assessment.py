"""The anonymous assessment HTTP API (build plan §20 Checkpoint 10.3).

Morpheo is a private Cloud Run service; the edge BFF is the only caller, so
these live under `/internal/v1`. The routes are a thin adapter over the pure
`AssessmentFlow` (Checkpoint 10.2) — no clinical logic here, only request
validation, the flow call, and the contract DTO. The claimant identity is the
already-validated actor the edge injects (§5.5), never sent by the browser.
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status

from morpheo.api.dependencies import BundleDep, FlowDep
from morpheo.clinical.models import SafetyLevelId
from morpheo.schemas.assessment import (
    AnswerSubmitRequestDTO,
    AssessmentClaimRequestDTO,
    AssessmentClaimResponseDTO,
    AssessmentClaimTokenResponseDTO,
    AssessmentCreateRequestDTO,
    AssessmentCreateResponseDTO,
    AssessmentResultDTO,
    AssessmentSnapshotResponseDTO,
)
from morpheo.schemas.content import AssessmentContentResponseDTO, build_content_response

router = APIRouter(prefix="/internal/v1/assessments", tags=["assessments"])

_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND, detail="assessment session not found"
)

ActorId = Annotated[str, Header(alias="X-Somnus-Actor-Id")]


@router.get(
    "/content",
    response_model=AssessmentContentResponseDTO,
    summary="Localized assessment display content (approved artifact wording).",
)
def get_content(bundle: BundleDep) -> AssessmentContentResponseDTO:
    return build_content_response(bundle)


@router.post("", response_model=AssessmentCreateResponseDTO, summary="Open an anonymous session.")
def create_assessment(
    body: AssessmentCreateRequestDTO, flow: FlowDep
) -> AssessmentCreateResponseDTO:
    outcome = flow.create(
        role=body.role,
        consent_given=body.consent_given,
        age_years=body.age_years,
        guardianship_confirmed=body.guardianship_confirmed,
        professional_confirmed=body.professional_confirmed,
        contains_identifiable_data=body.contains_identifiable_data,
        base_orientation=SafetyLevelId(body.base_orientation),
    )
    return AssessmentCreateResponseDTO(
        allowed=outcome.allowed, session_id=outcome.session_id, reason=outcome.reason
    )


@router.post(
    "/{session_id}/answers",
    response_model=AssessmentResultDTO,
    summary="Submit one validated answer and re-evaluate.",
)
def submit_answer(
    session_id: str, body: AnswerSubmitRequestDTO, flow: FlowDep
) -> AssessmentResultDTO:
    if not flow.has_session(session_id):
        raise _NOT_FOUND
    if body.kind == "complaint":
        result = flow.submit_complaint(session_id, body.name)
    else:
        value = None if body.value in (None, "unknown") else body.value == "true"
        result = flow.submit_signal(session_id, body.name, value)
    assert result is not None  # existence checked above
    return AssessmentResultDTO.from_result(result)


@router.get(
    "/{session_id}/summary",
    response_model=AssessmentResultDTO,
    summary="The current deterministic result.",
)
def get_summary(session_id: str, flow: FlowDep) -> AssessmentResultDTO:
    result = flow.summary(session_id)
    if result is None:
        raise _NOT_FOUND
    return AssessmentResultDTO.from_result(result)


@router.post(
    "/{session_id}/claim-token",
    response_model=AssessmentClaimTokenResponseDTO,
    summary="Mint a single-use claim token for the anonymous->authenticated handoff.",
)
def issue_claim_token(session_id: str, flow: FlowDep) -> AssessmentClaimTokenResponseDTO:
    if not flow.has_session(session_id):
        raise _NOT_FOUND
    return AssessmentClaimTokenResponseDTO(token=flow.request_claim_token(session_id))


@router.post(
    "/claim",
    response_model=AssessmentClaimResponseDTO,
    summary="Claim an assessment exactly once with a single-use token.",
)
def claim_assessment(
    body: AssessmentClaimRequestDTO, flow: FlowDep, actor_id: ActorId
) -> AssessmentClaimResponseDTO:
    outcome = flow.claim(body.token, claimed_by=actor_id)
    return AssessmentClaimResponseDTO(
        success=outcome.success, snapshot_id=outcome.snapshot_id, reason=outcome.reason
    )


@router.get(
    "/{session_id}/snapshot",
    response_model=AssessmentSnapshotResponseDTO,
    summary="The immutable snapshot frozen at claim.",
)
def get_snapshot(session_id: str, flow: FlowDep) -> AssessmentSnapshotResponseDTO:
    snapshot = flow.get_snapshot(session_id)
    if snapshot is None:
        raise _NOT_FOUND
    result = AssessmentResultDTO.model_validate(json.loads(snapshot.result_json))
    return AssessmentSnapshotResponseDTO(
        snapshot_id=snapshot.id,
        session_id=snapshot.session_id,
        result=result,
        workflow_version=snapshot.workflow_version,
        content_version=snapshot.content_version,
    )
