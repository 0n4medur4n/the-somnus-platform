"""The v2 report as a PDF, on demand, kept nowhere."""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from typing import Protocol

from report.application.funnel_passages import FunnelPassages
from report.rendering.funnel_renderer import render_funnel_html, template_version
from report.schemas.render import FunnelReportRequestDTO, ReportPdfDTO


class PdfRenderer(Protocol):
    def to_pdf(self, html: str) -> bytes: ...


class FunnelReportService:
    def __init__(self, pdf_renderer: PdfRenderer, passages: FunnelPassages | None = None) -> None:
        self._pdf = pdf_renderer
        self._passages = passages

    def render_pdf(self, request: FunnelReportRequestDTO) -> ReportPdfDTO:
        pro = request.report.professional if request.report else None
        found = self._passages.find(pro.grounding) if self._passages and pro else ()
        pdf_bytes = self._pdf.to_pdf(render_funnel_html(request, found))
        return ReportPdfDTO(
            assessment_id=request.session_id,
            template_version=template_version(request),
            definition_version=request.rules_version,
            content_version=request.content_version,
            locale=request.locale,
            created_at=datetime.now(UTC).isoformat(),
            pdf_base64=base64.b64encode(pdf_bytes).decode("ascii"),
        )
