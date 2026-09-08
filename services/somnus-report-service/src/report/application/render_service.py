"""The render pipeline (build plan §20 Checkpoint 11.1).

fetch approved Morpheo content -> render deterministic HTML -> PDF (WeasyPrint)
-> store both privately -> return an immutable ReportRef with short-lived signed
URLs. The service never recalculates a level, route, or decision (§5.6).
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Protocol

from report.application.ai_rewrite import AiRewriteDisabledError
from report.application.retrieval import SourceRetriever
from report.infrastructure.morpheo_client import ContentProvider
from report.infrastructure.pdf import PdfRenderer
from report.infrastructure.storage import StorageBackend
from report.rendering.renderer import render_html
from report.schemas.render import ClinicalContentDTO, ReportRefDTO, ReportRenderRequestDTO
from report.schemas.retrieval import RetrievalQuery, RetrievedSource

logger = logging.getLogger("report.render")


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


class ApprovedCandidateSource(Protocol):
    """What the render pipeline is allowed to ask the review queue.

    Deliberately one method, and deliberately the approved one. The pipeline
    cannot request "the candidate for this report" and then decide for itself
    whether the status permits it -- the only question it can ask already has the
    status filter inside the answer (see ContentReviewService.approved_candidate).
    """

    def approved_candidate(self, report_id: str) -> str | None: ...


class RenderService:
    def __init__(
        self,
        content_provider: ContentProvider,
        pdf_renderer: PdfRenderer,
        storage: StorageBackend,
        signed_url_ttl: timedelta,
        ai_rewrite_enabled: bool = False,
        retriever: SourceRetriever | None = None,
        review: ApprovedCandidateSource | None = None,
    ) -> None:
        self._content = content_provider
        self._pdf = pdf_renderer
        self._storage = storage
        self._ttl = signed_url_ttl
        # Master switch for AI rewriting (§15); off by default. See ai_rewrite.
        self._ai_rewrite_enabled = ai_rewrite_enabled
        # Explanation-only grounding (§3.6b); optional. None -> no citations.
        self._retriever = retriever
        # The human review queue (Checkpoint 15.3). Consulted only when the flag
        # above is on; None means "no approvals reachable", which the gate treats
        # exactly like no approval existing.
        self._review = review

    def _citations(
        self, request: ReportRenderRequestDTO, content: ClinicalContentDTO
    ) -> list[RetrievedSource]:
        """Retrieve grounding citations for the professional output (§3.6b).

        Guarded so retrieval can NEVER affect the decision: it runs only for the
        professional role, queries only approved terms (module names — no PII or
        health text), and ANY failure degrades to no citations. The level and the
        routing are unaffected regardless of what retrieval returns or raises.
        """
        if self._retriever is None or request.role != "professional":
            return []
        modules_by_id = {module.id: module for module in content.modules}
        queries = [
            RetrievalQuery(module_id=route, text=modules_by_id[route].name)
            for route in request.routes
            if route in modules_by_id
        ]
        if not queries:
            return []
        try:
            return list(self._retriever.retrieve(request.content_version, queries))
        except Exception:
            logger.warning("clinical-source retrieval failed; rendering without citations")
            return []

    def _finalize_html(self, html: str, report_id: str) -> str:
        """The one seam where AI rewriting could ever enter the pipeline (§15).

        Off (the default): return the deterministic HTML unchanged — the Rewriter
        is never constructed or invoked, and the review queue is not consulted.

        On: the ONLY thing that can make AI text eligible is an approved review
        item (Checkpoint 15.3). The lookup asks the review service for the
        APPROVED candidate; there is no call that returns a rejected or pending
        one, so those cannot reach this point even in principle. Absent an
        approval, this raises exactly as it did in 11.2 — the guard is the same
        one, now with something able to satisfy it rather than nothing.

        Eligibility is as far as this checkpoint goes: an approved candidate does
        not yet get substituted into the output. Wiring that substitution belongs
        with the decision to enable the flag, which is the clinical lead's after
        using the queue, not this checkpoint's.
        """
        if not self._ai_rewrite_enabled:
            return html
        approved = None if self._review is None else self._review.approved_candidate(report_id)
        if approved is None:
            raise AiRewriteDisabledError(
                "AI_REWRITE_ENABLED is on but no approved review item exists for this "
                "report (§15). Unreviewed, pending, and rejected AI text can never be "
                "served; only a human approval in the content review queue makes a "
                "candidate eligible."
            )
        return html

    def render(self, request: ReportRenderRequestDTO) -> ReportRefDTO:
        content = self._content.get_content()
        citations = self._citations(request, content)
        rendered = render_html(request, content, citations=citations)
        # Minted before finalizing so the AI gate can ask the review queue about
        # THIS report. Nothing is stored under it until the gate has allowed the
        # render to proceed.
        report_id = uuid.uuid4().hex
        html = self._finalize_html(rendered.html, report_id)
        pdf_bytes = self._pdf.to_pdf(html)

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
