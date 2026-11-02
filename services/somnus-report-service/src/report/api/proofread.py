"""Proofreading a Drive document (owner decision 2026-11-02, ADR 0019).

Private service; edge-api is the only caller, after identity granted
`admin_drive`. The text is a member of staff's own writing: it is never logged,
stored or kept beyond the call.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from report.application.proofread import ProofreadService, ProofreadUnavailableError
from report.schemas.proofread import ProofreadRequestDTO, ProofreadResultDTO

router = APIRouter(prefix="/internal/v1/drive", tags=["drive"])


@router.post(
    "/proofread",
    response_model=ProofreadResultDTO,
    summary="Corrections of spelling, grammar and punctuation, for the person to accept or not.",
)
def proofread(body: ProofreadRequestDTO, request: Request) -> ProofreadResultDTO:
    service: ProofreadService = request.app.state.proofread_service
    try:
        return service.proofread(body)
    except ProofreadUnavailableError as error:
        raise HTTPException(status_code=503, detail="Proofreading is unavailable.") from error
