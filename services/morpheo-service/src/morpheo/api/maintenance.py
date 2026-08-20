"""Retention/cleanup endpoints (build plan §20 Checkpoint 12.2).

Private, server-to-server: the worker's Cloud Scheduler jobs call these to purge
rows older than a worker-computed cutoff. Morpheo owns the deletion (it owns the
data, §7); the worker owns the schedule. No assessment content leaves here.
"""

from __future__ import annotations

from fastapi import APIRouter

from morpheo.api.dependencies import SessionDep
from morpheo.repositories.assessment import AssessmentRepository
from morpheo.schemas.maintenance import (
    AccountAssessmentsDeleteRequestDTO,
    MaintenanceDeleteRequestDTO,
    MaintenanceDeleteResultDTO,
)

router = APIRouter(prefix="/internal/v1/maintenance", tags=["maintenance"])


@router.post(
    "/unclaimed-assessments/delete",
    response_model=MaintenanceDeleteResultDTO,
    summary="Delete open (unclaimed) assessments created before the cutoff (30-day TTL).",
)
def delete_unclaimed(
    body: MaintenanceDeleteRequestDTO, session: SessionDep
) -> MaintenanceDeleteResultDTO:
    deleted = AssessmentRepository(session).delete_unclaimed_before(body.before)
    return MaintenanceDeleteResultDTO(deleted=deleted)


@router.post(
    "/claim-tokens/delete",
    response_model=MaintenanceDeleteResultDTO,
    summary="Delete claim tokens created before the cutoff (72 h TTL).",
)
def delete_claim_tokens(
    body: MaintenanceDeleteRequestDTO, session: SessionDep
) -> MaintenanceDeleteResultDTO:
    deleted = AssessmentRepository(session).delete_claim_tokens_before(body.before)
    return MaintenanceDeleteResultDTO(deleted=deleted)


@router.post(
    "/user-assessments/delete",
    response_model=MaintenanceDeleteResultDTO,
    summary="Erase every assessment a user claimed (account deletion, §13.2).",
)
def delete_user_assessments(
    body: AccountAssessmentsDeleteRequestDTO, session: SessionDep
) -> MaintenanceDeleteResultDTO:
    deleted = AssessmentRepository(session).delete_by_claimed_by(body.user_id)
    return MaintenanceDeleteResultDTO(deleted=deleted)
