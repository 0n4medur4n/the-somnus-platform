"""The report render endpoint (build plan §20 Checkpoint 11.1).

Private service; the edge (or worker) is the only caller, so it lives under
`/internal/v1`. Thin adapter over the RenderService on app.state.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from report.application.funnel_report import FunnelReportService
from report.application.narrative import NarrativeService
from report.application.render_service import RenderService
from report.infrastructure.morpheo_client import ContentProvider
from report.repositories.person_report_repository import PersonReportRepositorySql
from report.schemas.narrative import NarrativeResponseDTO
from report.schemas.render import (
    FunnelReportRequestDTO,
    PersonReportsDeleteRequestDTO,
    PersonReportsDeleteResultDTO,
    ReportPdfDTO,
    ReportRefDTO,
    ReportRenderRequestDTO,
)

router = APIRouter(prefix="/internal/v1/reports", tags=["reports"])


@router.post(
    "",
    response_model=ReportRefDTO,
    summary="Render + store a report from an approved Morpheo result.",
)
def render_report(body: ReportRenderRequestDTO, request: Request) -> ReportRefDTO:
    service: RenderService = request.app.state.render_service
    return service.render(body)


@router.post(
    "/pdf",
    response_model=ReportPdfDTO,
    summary="Render a report as a PDF on demand (not stored).",
)
def render_report_pdf(body: ReportRenderRequestDTO, request: Request) -> ReportPdfDTO:
    service: RenderService = request.app.state.render_service
    return service.render_pdf(body)


@router.post(
    "/narrative",
    response_model=NarrativeResponseDTO,
    summary="The person's AI-written report for one assessment (written once, then stored).",
)
def person_report(body: ReportRenderRequestDTO, request: Request) -> NarrativeResponseDTO:
    narratives: NarrativeService = request.app.state.narrative_service
    content: ContentProvider = request.app.state.content_provider
    return narratives.for_assessment(body, content.get_content())


@router.post(
    "/person/delete",
    response_model=PersonReportsDeleteResultDTO,
    summary="Erase the stored person's reports of these assessments (right to erasure).",
)
def delete_person_reports(
    body: PersonReportsDeleteRequestDTO, request: Request
) -> PersonReportsDeleteResultDTO:
    store: PersonReportRepositorySql = request.app.state.person_reports
    return PersonReportsDeleteResultDTO(deleted=store.delete_for(body.assessment_ids))


@router.post(
    "/funnel/pdf",
    response_model=ReportPdfDTO,
    summary="The v2 report (embudo v0.2) as a PDF: morpheo's final text, laid out, not stored.",
)
def funnel_report_pdf(body: FunnelReportRequestDTO, request: Request) -> ReportPdfDTO:
    service: FunnelReportService = request.app.state.funnel_reports
    return service.render_pdf(body)
