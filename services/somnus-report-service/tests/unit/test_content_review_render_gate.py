"""A rejected candidate can never be rendered (Checkpoint 15.3).

Asserted at the RENDER PIPELINE, not at the queue: the queue refusing to hand out
a rejected candidate is necessary but not sufficient, because the thing that must
never happen is rejected prose reaching a stored report. So these drive
`RenderService.render` and then look at what was actually written to storage.

`AI_REWRITE_ENABLED` is off in every environment and stays off for this
checkpoint. It is switched on *inside these tests only*, by constructing a
RenderService with the flag set, because a gate that is never exercised is not a
gate -- the default-off path is covered separately, and
`test_render_service.py::...settings default` still asserts the shipped default.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from pathlib import Path

import pytest

from report.application.ai_rewrite import AiRewriteDisabledError
from report.application.content_review import (
    STATUS_APPROVED,
    STATUS_REJECTED,
    ContentReviewService,
)
from report.application.render_service import RenderService
from report.infrastructure.forbidden import ForbiddenPhraseScanner
from report.infrastructure.storage import LocalStorageBackend
from report.schemas.render import ClinicalContentDTO, ReportRenderRequestDTO
from report.settings.config import Settings

RequestBuilder = Callable[..., ReportRenderRequestDTO]

REJECTED_TEXT = "Una reescritura que el revisor rechazo por sonar a diagnostico."
APPROVED_TEXT = "Una reescritura que el revisor aprobo por ser fiel al original."
SEEDED_REPORT = "seeded-report"


class _FakeContent:
    def __init__(self, content: ClinicalContentDTO) -> None:
        self._content = content

    def get_content(self) -> ClinicalContentDTO:
        return self._content


class _FakePdf:
    def to_pdf(self, html: str) -> bytes:
        return b"%PDF-1.7 fake " + html.encode("utf-8")


class _SeededReview:
    """Answers the pipeline's one question against a seeded report.

    `render` mints a fresh report id, so it would never match a seeded row; this
    adapter routes the question to the seeded item instead. What it does NOT do is
    bypass the status filter -- it calls the real `approved_candidate`, so a
    rejected or pending item still yields None exactly as in production.
    """

    def __init__(self, service: ContentReviewService) -> None:
        self._service = service

    def approved_candidate(self, report_id: str) -> str | None:
        return self._service.approved_candidate(SEEDED_REPORT)


def _seed(
    make_review_service: Callable[[], ContentReviewService], status: str | None, text: str
) -> _SeededReview:
    """Queue a candidate and optionally decide it."""
    service = make_review_service()
    scanner = ForbiddenPhraseScanner(forbidden_phrases=[], blocked_claims=[])
    item = service.enqueue(
        report_id=SEEDED_REPORT,
        deterministic_text="El resultado estructurado aprobado.",
        candidate_text=text,
        scanner=scanner,
        model_id="gpt-5.6",
        prompt_template_version="v1",
        prompt_template_id="rewrite_plain_language",
    )
    assert item is not None
    if status is not None:
        service.decide(
            item.item_id,
            status=status,
            reviewer_id="rev-1",
            reason="a recorded reason, as both directions require",
        )
    return _SeededReview(service)


def _service(
    tmp_path: Path,
    content: ClinicalContentDTO,
    review: _SeededReview,
    *,
    ai_rewrite_enabled: bool,
) -> RenderService:
    return RenderService(
        content_provider=_FakeContent(content),
        pdf_renderer=_FakePdf(),
        storage=LocalStorageBackend(root=tmp_path, base_url="http://x/reports"),
        signed_url_ttl=timedelta(minutes=15),
        ai_rewrite_enabled=ai_rewrite_enabled,
        review=review,
    )


def _stored_text(root: Path) -> str:
    """Everything the pipeline actually wrote, HTML and PDF alike."""
    return "".join(
        path.read_bytes().decode("utf-8", errors="ignore")
        for path in root.rglob("*")
        if path.is_file()
    )


class TestARejectedItemCanNeverBeRendered:
    def test_the_pipeline_refuses_and_stores_nothing(
        self,
        tmp_path: Path,
        content: ClinicalContentDTO,
        make_request: RequestBuilder,
        make_review_service: Callable[[], ContentReviewService],
    ) -> None:
        service = _service(
            tmp_path,
            content,
            _seed(make_review_service, STATUS_REJECTED, REJECTED_TEXT),
            ai_rewrite_enabled=True,
        )

        with pytest.raises(AiRewriteDisabledError):
            service.render(make_request(locale="es", level="L4", routes=("INS",)))

        # The report id is minted before the gate runs; nothing may be written
        # under it when the gate refuses.
        assert list(tmp_path.rglob("*.html")) == []
        assert REJECTED_TEXT not in _stored_text(tmp_path)

    def test_a_still_pending_item_is_refused_the_same_way(
        self,
        tmp_path: Path,
        content: ClinicalContentDTO,
        make_request: RequestBuilder,
        make_review_service: Callable[[], ContentReviewService],
    ) -> None:
        service = _service(
            tmp_path,
            content,
            _seed(make_review_service, None, REJECTED_TEXT),
            ai_rewrite_enabled=True,
        )

        with pytest.raises(AiRewriteDisabledError):
            service.render(make_request(locale="es", level="L4", routes=("INS",)))

        assert REJECTED_TEXT not in _stored_text(tmp_path)

    def test_the_rejected_text_stays_out_even_with_the_flag_off(
        self,
        tmp_path: Path,
        content: ClinicalContentDTO,
        make_request: RequestBuilder,
        make_review_service: Callable[[], ContentReviewService],
    ) -> None:
        # The default path: deterministic output, queue never consulted. The
        # rejected prose must be absent for the ordinary reason too, not only
        # because the gate raised.
        service = _service(
            tmp_path,
            content,
            _seed(make_review_service, STATUS_REJECTED, REJECTED_TEXT),
            ai_rewrite_enabled=False,
        )

        ref = service.render(make_request(locale="es", level="L4", routes=("INS",)))

        assert ref.report_id
        assert REJECTED_TEXT not in _stored_text(tmp_path)


class TestAnApprovedItemIsWhatMakesRenderingEligible:
    def test_the_pipeline_proceeds_when_an_approval_exists(
        self,
        tmp_path: Path,
        content: ClinicalContentDTO,
        make_request: RequestBuilder,
        make_review_service: Callable[[], ContentReviewService],
    ) -> None:
        service = _service(
            tmp_path,
            content,
            _seed(make_review_service, STATUS_APPROVED, APPROVED_TEXT),
            ai_rewrite_enabled=True,
        )

        ref = service.render(make_request(locale="es", level="L4", routes=("INS",)))

        # Eligibility, which is as far as 15.3 goes: the render is allowed to
        # proceed. Substituting the approved prose into the output belongs with
        # the decision to enable the flag, not with building the queue.
        assert ref.report_id
        assert (tmp_path / ref.report_id / "es" / "report.html").exists()

    def test_without_the_queue_wired_at_all_the_gate_still_refuses(
        self,
        tmp_path: Path,
        content: ClinicalContentDTO,
        make_request: RequestBuilder,
        make_review_service: Callable[[], ContentReviewService],
    ) -> None:
        # 11.2's behaviour, unchanged: flag on, no approval reachable -> refuse.
        service = RenderService(
            content_provider=_FakeContent(content),
            pdf_renderer=_FakePdf(),
            storage=LocalStorageBackend(root=tmp_path, base_url="http://x/reports"),
            signed_url_ttl=timedelta(minutes=15),
            ai_rewrite_enabled=True,
        )

        with pytest.raises(AiRewriteDisabledError):
            service.render(make_request(locale="es", level="L4", routes=("INS",)))


def test_the_shipped_default_for_the_flag_is_still_off() -> None:
    """15.3 builds the mechanism; it does not turn anything on."""
    assert Settings().ai_rewrite_enabled is False
