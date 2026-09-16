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
from report.application.retrieval import CitationResolver, SourceRetriever
from report.infrastructure.morpheo_client import ContentProvider
from report.infrastructure.pdf import PdfRenderer
from report.infrastructure.storage import StorageBackend
from report.rendering.renderer import render_html
from report.schemas.render import ClinicalContentDTO, ReportRefDTO, ReportRenderRequestDTO
from report.schemas.retrieval import (
    GroundingMaterial,
    GroundingRequest,
    RetrievalQuery,
    RetrievedSource,
)

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


class GroundingSource(Protocol):
    """Index B, as the render pipeline is allowed to see it (§B3.1 / 16.4).

    It returns `GroundingMaterial` and there is no overload that returns a
    `RetrievedSource`. That is the §B3.1 guarantee expressed as a type: the
    citation resolves from Index A, and this protocol gives no one a way to say
    otherwise, whatever Index B contains or does.
    """

    def retrieve(
        self, request: GroundingRequest, queries: tuple[RetrievalQuery, ...] = ()
    ) -> list[GroundingMaterial]: ...


class ProvenanceSink(Protocol):
    """Where a report's corpus provenance is stamped (§B5 Checkpoint 16.5).

    One method, and it only writes. The render pipeline has no way to read a
    provenance record back, let alone revise one: provenance is written once, at
    generation, and a pipeline that could rewrite it would make "what grounded
    this report" a question with more than one answer.
    """

    def record(
        self,
        report_id: str,
        *,
        content_version: str,
        locale: str,
        citations: list[RetrievedSource],
        grounding: list[GroundingMaterial],
    ) -> None: ...


class RenderService:
    def __init__(
        self,
        content_provider: ContentProvider,
        pdf_renderer: PdfRenderer,
        storage: StorageBackend,
        signed_url_ttl: timedelta,
        ai_rewrite_enabled: bool = False,
        citations: CitationResolver | None = None,
        retriever: SourceRetriever | None = None,
        review: ApprovedCandidateSource | None = None,
        grounding: GroundingSource | None = None,
        provenance: ProvenanceSink | None = None,
    ) -> None:
        self._content = content_provider
        self._pdf = pdf_renderer
        self._storage = storage
        self._ttl = signed_url_ttl
        # Master switch for AI rewriting (§15); off by default. See ai_rewrite.
        self._ai_rewrite_enabled = ai_rewrite_enabled
        # The by-id path (§14b / Checkpoint 11.3 Stage 4): the sources the fired
        # rule actually cited. Needs no embedder and no key, so it is wired in
        # every environment.
        self._citation_resolver = citations
        # The similarity fallback (§3.6b), for reports that fired no rule at all.
        # Optional: no embedding key -> None -> those reports carry no citations.
        self._retriever = retriever
        # The human review queue (Checkpoint 15.3). Consulted only when the flag
        # above is on; None means "no approvals reachable", which the gate treats
        # exactly like no approval existing.
        self._review = review
        # Index B (Addendum B §B3.1). Supporting material only, and optional in
        # every sense: unwired, empty, wrong or raising, it changes no citation,
        # no level and no route. See `_grounding`.
        self._grounding = grounding
        # Checkpoint 16.5: what grounded this report, stamped as it is generated.
        # Optional like the rest of the grounding chain -- a report renders
        # whether or not its provenance could be written, because the report is
        # the clinical artefact and the provenance is a record about it.
        self._provenance = provenance

    def _citations(
        self, request: ReportRenderRequestDTO, content: ClinicalContentDTO
    ) -> list[RetrievedSource]:
        """Grounding citations for the professional output (§3.6b / §14b).

        Two paths, in a fixed order, and the order is the correctness property:

        1. **By id.** The sources the fired rules cited, looked up from
           `citedByRules`. This is what §14b means by "the approved clinical
           source that the deterministic rule already cited". Exact, not ranked.
        2. **By similarity**, ONLY when step 1 found nothing to resolve — a
           report that fired no rule, or fired rules that cite no source. There
           is no rule-cited source to be exact about in that case, so ranking the
           routed module names is the best available grounding rather than a
           worse alternative to something better.

        A rule-cited report never reaches step 2, which is the whole point: it
        cannot end up citing a plausible source instead of the named one.

        Guarded so neither path can affect the decision: both run only for the
        professional role, query only approved terms, and ANY failure degrades to
        no citations. The level and the routing are unaffected regardless of what
        either returns or raises.
        """
        if request.role != "professional":
            return []

        if self._citation_resolver is not None:
            try:
                cited = list(
                    self._citation_resolver.resolve(
                        request.content_version, list(request.triggered_rules)
                    )
                )
            except Exception:
                logger.warning("clinical-source citation lookup failed; trying similarity")
                cited = []
            if cited:
                return cited

        if self._retriever is None:
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

    def _grounding_material(
        self,
        request: ReportRenderRequestDTO,
        content: ClinicalContentDTO,
        cited: list[RetrievedSource],
    ) -> list[GroundingMaterial]:
        """Supporting material from Index B (Addendum B §B3.1, Checkpoint 16.4).

        Called AFTER `_citations` and given its result, which is the ordering that
        makes §B3.1 true: Index A decides the citation, and Index B is then asked
        for enrichment scoped to the sources Index A already named. Index B
        follows the citation; it never has a chance to influence it.

        Scoped to what the deterministic result activated and nothing else — the
        routed modules, the fired rules, and the SRC entries those rules cited.
        Every failure mode ends in an empty list, because §B3.1 says a missing or
        empty enrichment "degrades the richness of the explanation and nothing
        else".
        """
        if request.role != "professional" or self._grounding is None:
            return []

        modules_by_id = {module.id: module for module in content.modules}
        queries = tuple(
            RetrievalQuery(module_id=route, text=modules_by_id[route].name)
            for route in request.routes
            if route in modules_by_id
        )
        try:
            return list(
                self._grounding.retrieve(
                    GroundingRequest(
                        locale=request.locale,
                        module_ids=tuple(request.routes),
                        rule_ids=tuple(request.triggered_rules),
                        source_ids=tuple(source.source_id for source in cited),
                    ),
                    queries,
                )
            )
        except Exception:
            logger.warning("corpus grounding lookup failed; rendering without supporting material")
            return []

    def _record_provenance(
        self,
        report_id: str,
        request: ReportRenderRequestDTO,
        citations: list[RetrievedSource],
        grounding: list[GroundingMaterial],
    ) -> None:
        """Stamp what grounded this report (Addendum B §B5 Checkpoint 16.5).

        Recorded after the render rather than before it, so what is stamped is
        what the report actually carries — the citations rendered into it and the
        supporting material rendered beside them, not what retrieval happened to
        return on the way.

        A failure here is logged and swallowed. The report is the thing the
        clinician reads; the provenance is a record about it, and losing the
        record must never cost the report. The reverse — a report with no
        provenance — is visible in the review queue as an absent panel rather
        than as a wrong one.
        """
        if self._provenance is None:
            return
        try:
            self._provenance.record(
                report_id,
                content_version=request.content_version,
                locale=request.locale,
                citations=citations,
                grounding=grounding,
            )
        except Exception:
            logger.warning("corpus provenance could not be recorded for this report")

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
        grounding = self._grounding_material(request, content, citations)
        rendered = render_html(request, content, citations=citations, grounding=grounding)
        # Minted before finalizing so the AI gate can ask the review queue about
        # THIS report. Nothing is stored under it until the gate has allowed the
        # render to proceed.
        report_id = uuid.uuid4().hex
        html = self._finalize_html(rendered.html, report_id)
        pdf_bytes = self._pdf.to_pdf(html)
        self._record_provenance(report_id, request, citations, grounding)

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
