"""Translating what is read aloud (owner decision 2026-11-03, ADR 0019).

Private service; edge-api is the only caller, after identity granted
`admin_drive`. The passages are never logged, stored or kept beyond the call.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from report.application.translate import TranslateService, TranslateUnavailableError
from report.schemas.translate import TranslateRequestDTO, TranslateResultDTO

router = APIRouter(prefix="/internal/v1/drive", tags=["drive"])


@router.post(
    "/translate",
    response_model=TranslateResultDTO,
    summary="The passages about to be read aloud, in the voice's language.",
)
def translate(body: TranslateRequestDTO, request: Request) -> TranslateResultDTO:
    service: TranslateService = request.app.state.translate_service
    try:
        return service.translate(body)
    except TranslateUnavailableError as error:
        raise HTTPException(status_code=503, detail="Translation is unavailable.") from error
