"""The case records over HTTP (ADR 0024): the console's reads, through the edge.

Private: the edge is the only caller, and it has already checked the admin's
capability and the justification's shape. Opening a case needs the acting
admin's id (the edge-injected actor header): the access is recorded under it.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status

from morpheo.api.dependencies import SessionDep
from morpheo.application.case_service import CaseService
from morpheo.schemas.cases import (
    FunnelCaseDTO,
    FunnelCaseOpenRequestDTO,
    FunnelCaseStatsDTO,
    FunnelCaseStatsRequestDTO,
)

router = APIRouter(prefix="/internal/v1/funnel/cases", tags=["funnel-cases"])

ActorId = Annotated[str, Header(alias="X-Somnus-Actor-Id", min_length=1)]


@router.post(
    "/stats",
    response_model=FunnelCaseStatsDTO,
    summary="Aggregate counts over the interviews' cases. Never a case, never a person.",
)
def stats(body: FunnelCaseStatsRequestDTO, session: SessionDep) -> FunnelCaseStatsDTO:
    return CaseService(session).stats(body)


@router.post(
    "/open",
    response_model=FunnelCaseDTO,
    summary="One case by its code: questions, answers and results as shown. Access recorded.",
)
def open_case(
    body: FunnelCaseOpenRequestDTO, session: SessionDep, actor_id: ActorId
) -> FunnelCaseDTO:
    case = CaseService(session).open(body, actor_id)
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case not found")
    return case
