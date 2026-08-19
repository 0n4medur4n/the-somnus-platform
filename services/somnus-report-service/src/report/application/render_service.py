"""The render pipeline (build plan §20 Checkpoint 11.1).

fetch approved Morpheo content -> render deterministic HTML -> PDF (WeasyPrint)
-> store both privately -> return an immutable ReportRef with short-lived signed
URLs. The service never recalculates a level, route, or decision (§5.6).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from report.application.ai_rewrite import AiRewriteDisabledError
from report.infrastructure.morpheo_client import ContentProvider
from report.infrastructure.pdf import PdfRenderer
from report.infrastructure.storage import StorageBackend
from report.rendering.renderer import render_html
from report.schemas.render import ReportRefDTO, ReportRenderRequestDTO


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


class RenderService:
    def __init__(
        self,
        content_provider: ContentProvider,
        pdf_renderer: PdfRenderer,
        storage: StorageBackend,
        signed_url_ttl: timedelta,
        ai_rewrite_enabled: bool = False,
    ) -> None:
        self._content = content_provider
        self._pdf = pdf_renderer
        self._storage = storage
        self._ttl = signed_url_ttl
        # Master switch for AI rewriting (§15); off by default. See ai_rewrite.
        self._ai_rewrite_enabled = ai_rewrite_enabled

    def _finalize_html(self, html: str) -> str:
        """The one seam where AI rewriting could ever enter the pipeline (§15).

        Off (the default): return the deterministic HTML unchanged — the Rewriter
        is never constructed or invoked. On: there is still no human-review
        mechanism for `pending_review` output, so serving unreviewed AI text is
        forbidden and we refuse rather than emit it.
        """
        if not self._ai_rewrite_enabled:
            return html
        raise AiRewriteDisabledError(
            "AI_REWRITE_ENABLED is on but AI rewriting cannot serve output: no "
            "human-review mechanism for pending_review exists yet (§15). Do not "
            "enable it in any environment until that mechanism is built and reviewed."
        )

    def render(self, request: ReportRenderRequestDTO) -> ReportRefDTO:
        content = self._content.get_content()
        rendered = render_html(request, content)
        html = self._finalize_html(rendered.html)
        pdf_bytes = self._pdf.to_pdf(html)

        report_id = uuid.uuid4().hex
        html_key = f"{report_id}/{request.locale}/report.html"
        pdf_key = f"{report_id}/{request.locale}/report.pdf"
        self._storage.put(html_key, html.encode("utf-8"), "text/html; charset=utf-8")
        self._storage.put(pdf_key, pdf_bytes, "application/pdf")

        return ReportRefDTO(
            report_id=report_id,
            assessment_id=request.assessment_id,
            template_version=rendered.template_version,
            definition_version=request.definition_version,
            content_version=request.content_version,
            locale=request.locale,
            created_at=_now_iso(),
            html_url=self._storage.signed_url(html_key, self._ttl).url,
            pdf_url=self._storage.signed_url(pdf_key, self._ttl).url,
        )
