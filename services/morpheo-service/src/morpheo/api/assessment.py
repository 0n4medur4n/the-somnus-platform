"""The anonymous assessment HTTP API (build plan §20 Checkpoint 10.3).

Morpheo is a private Cloud Run service; the edge BFF is the only caller, so
these live under `/internal/v1`. The routes are a thin adapter over the pure
`AssessmentFlow` (Checkpoint 10.2) — no clinical logic here, only request
validation, the flow call, and the contract DTO. The claimant identity is the
already-validated actor the edge injects (§5.5), never sent by the browser.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
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
    OwnAssessmentDTO,
    OwnAssessmentsResponseDTO,
    UserAssessmentSnapshotDTO,
    UserAssessmentsRequestDTO,
    UserAssessmentsResponseDTO,
)
from morpheo.schemas.content import AssessmentContentResponseDTO, build_content_response

router = APIRouter(prefix="/internal/v1/assessments", tags=["assessments"])

_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND, detail="assessment session not found"
)

ActorId = Annotated[str, Header(alias="X-Somnus-Actor-Id")]
# Optional at the HTTP layer so a missing actor reads exactly like a record that
# is not yours: 404, never a 422 that confirms the route and the session exist.
OptionalActorId = Annotated[str | None, Header(alias="X-Somnus-Actor-Id")]


def _iso_utc(moment: datetime) -> str:
    """ISO 8601 with an explicit offset. The database stores UTC without a zone;
    a bare timestamp would be read as local time by the browser."""
    aware = moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)
    return aware.astimezone(UTC).isoformat()


@router.get(
    "/content",
    response_model=AssessmentContentResponseDTO,
    summary="Localized assessment display content (approved artifact wording).",
)
def get_content(bundle: BundleDep) -> AssessmentContentResponseDTO:
    return build_content_response(bundle)


@router.get(
    "/mine",
    response_model=OwnAssessmentsResponseDTO,
    summary="The caller's own claimed assessments, newest first.",
)
def get_own_assessments(flow: FlowDep, actor_id: ActorId) -> OwnAssessmentsResponseDTO:
    """The signed-in person's history. Scoped by the edge-injected actor, so it can
    only ever answer about the caller -- unlike `/by-user`, which is break-glass."""
    assessments: list[OwnAssessmentDTO] = []
    for snapshot in flow.snapshots_for_user(actor_id):
        result = AssessmentResultDTO.model_validate(json.loads(snapshot.result_json))
        assessments.append(
            OwnAssessmentDTO(
                session_id=snapshot.session_id,
                role=result.role,
                level=result.level,
                stop=result.stop,
                created_at=_iso_utc(snapshot.created_at),
            )
        )
    return OwnAssessmentsResponseDTO(assessments=assessments)


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
    summary="The immutable snapshot frozen at claim, for the person who claimed it.",
)
def get_snapshot(
    session_id: str, flow: FlowDep, actor_id: OptionalActorId = None
) -> AssessmentSnapshotResponseDTO:
    # Owner only. A snapshot is a person's health result; the edge resolves the
    # signed-in person and injects them, and anyone else gets the same 404 as a
    # session that never existed.
    snapshot = flow.get_owned_snapshot(session_id, actor_id) if actor_id else None
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


@router.post(
    "/by-user",
    response_model=UserAssessmentsResponseDTO,
    summary="Every assessment a person claimed. Break-glass only (Addendum A §A2.3).",
)
def get_user_assessments(
    body: UserAssessmentsRequestDTO, flow: FlowDep
) -> UserAssessmentsResponseDTO:
    """The clinical side of break-glass (Checkpoint 15.5).

    Two things this route deliberately does not do. It does not decide whether the
    caller may see this: identity owns every authorization decision (§5.3), the edge
    names the capability, and morpheo would be duplicating a decision it cannot make
    correctly. And it does not record the access: the audit event carries the admin's
    justification and category, which are the edge's to collect, and one action should
    produce one audit record rather than two half-records in two stores.

    POST rather than GET so the person's id does not land in an access log — the same
    reason the audit query is a POST.
    """
    snapshots = flow.snapshots_for_user(body.user_id)
    return UserAssessmentsResponseDTO(
        snapshots=[
            UserAssessmentSnapshotDTO(
                snapshot_id=snapshot.id,
                session_id=snapshot.session_id,
                result=AssessmentResultDTO.model_validate(json.loads(snapshot.result_json)),
                workflow_version=snapshot.workflow_version,
                content_version=snapshot.content_version,
                created_at=snapshot.created_at.isoformat(),
            )
            for snapshot in snapshots
        ]
    )
