"""The report render endpoint (build plan §20 Checkpoint 11.1).

Private service; the edge (or worker) is the only caller, so it lives under
`/internal/v1`. Thin adapter over the RenderService on app.state.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from report.application.render_service import RenderService
from report.schemas.render import ReportRefDTO, ReportRenderRequestDTO

router = APIRouter(prefix="/internal/v1/reports", tags=["reports"])


@router.post(
    "",
    response_model=ReportRefDTO,
    summary="Render + store a report from an approved Morpheo result.",
)
def render_report(body: ReportRenderRequestDTO, request: Request) -> ReportRefDTO:
    service: RenderService = request.app.state.render_service
    return service.render(body)
