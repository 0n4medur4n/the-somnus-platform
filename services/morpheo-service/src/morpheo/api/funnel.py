"""The v2 interview HTTP API (the embudo v0.2, ADR 0020).

Private: the edge is the only caller. A thin adapter over `FunnelService` --
no clinical logic here. A signed-in person's id arrives only as the
edge-injected actor header, never from the browser; their interview is theirs
from the start, and reads to anyone else as one that does not exist.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse

from morpheo.api.dependencies import SessionDep
from morpheo.application.funnel_service import AnswerRejected, FunnelService
from morpheo.infrastructure.correlation import CORRELATION_ID_HEADER
from morpheo.infrastructure.errors import build_error_body
from morpheo.schemas.funnel import (
    FunnelAnswerRequestDTO,
    FunnelConfigResponseDTO,
    FunnelCreateRequestDTO,
    FunnelOwnSessionsDTO,
    FunnelRewindRequestDTO,
    FunnelStateDTO,
)
from morpheo.settings.config import Settings

router = APIRouter(prefix="/internal/v1/funnel", tags=["funnel"])

OptionalActorId = Annotated[str | None, Header(alias="X-Somnus-Actor-Id")]

_NOT_FOUND = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="interview not found")


def get_funnel_service(session: SessionDep, request: Request) -> FunnelService:
    return FunnelService(
        session,
        registry=request.app.state.instruments,
        ai=getattr(request.app.state, "ai", None),
        informe=getattr(request.app.state, "informe", None),
    )


FunnelServiceDep = Annotated[FunnelService, Depends(get_funnel_service)]


def _found(state: FunnelStateDTO | None) -> FunnelStateDTO:
    if state is None:
        raise _NOT_FOUND
    return state


async def _answer_rejected(request: Request, exc: Exception) -> JSONResponse:
    """An answer that does not fit its step: the §16 envelope with the reason
    (e.g. "identifying_data") in `details`, for the app to explain it."""
    reason = exc.code if isinstance(exc, AnswerRejected) else "invalid_value"
    correlation_id = getattr(request.state, "correlation_id", "unknown")
    body = build_error_body(
        code="VALIDATION_FAILED",
        message="The answer does not fit the step being asked.",
        correlation_id=correlation_id,
        details={"reason": reason},
    )
    return JSONResponse(
        status_code=422, content=body, headers={CORRELATION_ID_HEADER: correlation_id}
    )


def register_funnel_errors(app: FastAPI) -> None:
    app.add_exception_handler(AnswerRejected, _answer_rejected)


@router.get(
    "/config",
    response_model=FunnelConfigResponseDTO,
    summary="Which assessment flow the app runs (FUNNEL_V2_ENABLED).",
)
def get_config(request: Request) -> FunnelConfigResponseDTO:
    settings: Settings = request.app.state.settings
    return FunnelConfigResponseDTO(active_flow="v2" if settings.funnel_v2_enabled else "v1")


@router.post(
    "/sessions",
    response_model=FunnelStateDTO,
    summary="Start an interview (health-data consent required); returns the first step.",
)
def create_session(
    body: FunnelCreateRequestDTO, service: FunnelServiceDep, actor_id: OptionalActorId = None
) -> FunnelStateDTO:
    return service.create(owner_id=actor_id)


@router.get(
    "/sessions",
    response_model=FunnelOwnSessionsDTO,
    summary="The caller's own finished interviews, newest first (nothing without an actor).",
)
def list_own_sessions(
    service: FunnelServiceDep, actor_id: OptionalActorId = None
) -> FunnelOwnSessionsDTO:
    return service.own_sessions(actor_id)


@router.get(
    "/sessions/{session_id}",
    response_model=FunnelStateDTO,
    summary="The interview as it stands: the step to show, or the result.",
)
def get_session(
    session_id: str, service: FunnelServiceDep, actor_id: OptionalActorId = None
) -> FunnelStateDTO:
    return _found(service.state(session_id, actor_id))


@router.post(
    "/sessions/{session_id}/answers",
    response_model=FunnelStateDTO,
    summary="Answer the step being served; returns the next step or the result.",
)
def answer(
    session_id: str,
    body: FunnelAnswerRequestDTO,
    service: FunnelServiceDep,
    actor_id: OptionalActorId = None,
) -> FunnelStateDTO:
    return _found(service.answer(session_id, actor_id, body))


@router.post(
    "/sessions/{session_id}/back",
    response_model=FunnelStateDTO,
    summary="Undo the last answer (the back button).",
)
def back(
    session_id: str, service: FunnelServiceDep, actor_id: OptionalActorId = None
) -> FunnelStateDTO:
    return _found(service.back(session_id, actor_id))


@router.post(
    "/sessions/{session_id}/rewind",
    response_model=FunnelStateDTO,
    summary="Go back to an answer to change it (Z1); what followed it is removed.",
)
def rewind(
    session_id: str,
    body: FunnelRewindRequestDTO,
    service: FunnelServiceDep,
    actor_id: OptionalActorId = None,
) -> FunnelStateDTO:
    return _found(service.rewind(session_id, actor_id, body.key))
