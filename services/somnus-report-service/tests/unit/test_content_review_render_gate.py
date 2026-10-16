"""Only human-approved AI wording ever reaches a report (build plan §15).

Replaces the Checkpoint 15.3 render-gate tests (owner decision 2026-10-16: AI
wording reviewed once per sentence, AI_REWRITE_ENABLED on everywhere). The
property protected is unchanged and is still asserted on what the pipeline
actually STORED, not on the queue: rejected or still-pending AI text never
reaches a report. What changed is the behaviour with nothing approved: the report
is no longer refused, it prints Morpheo's approved original.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from pathlib import Path

from report.application.content_review import (
    STATUS_APPROVED,
    STATUS_REJECTED,
    ContentReviewService,
)
from report.application.render_service import RenderService
from report.infrastructure.forbidden import ForbiddenPhraseScanner
from report.infrastructure.storage import LocalStorageBackend
from report.rendering.renderer import render_html
from report.schemas.render import ClinicalContentDTO, ReportRenderRequestDTO
from report.settings.config import Settings

RequestBuilder = Callable[..., ReportRenderRequestDTO]

VERSION = "rewrite_v1"
INS_OUTPUT = "Has comunicado un patrón de dificultad para dormir."
L1_ACTION = "No conduzcas ni realices tareas de riesgo; busca valoración hoy."
APPROVED_INS = "Nos cuentas que te cuesta dormir; es un patrón que vale la pena revisar."
REJECTED_INS = "Tienes insomnio crónico y necesitas tratamiento."


class _FakeContent:
    def __init__(self, content: ClinicalContentDTO) -> None:
        self._content = content

    def get_content(self) -> ClinicalContentDTO:
        return self._content


class _FakePdf:
    def to_pdf(self, html: str) -> bytes:
        return b"%PDF-1.7 fake " + html.encode("utf-8")


class _Wording:
    """The render pipeline's view of the queue: approved rewordings only."""

    def __init__(self, service: ContentReviewService) -> None:
        self._service = service

    def approved_rewrite(self, deterministic_text: str) -> str | None:
        return self._service.approved_rewrite(deterministic_text, prompt_template_version=VERSION)


def _queue(service: ContentReviewService, text: str, candidate: str, status: str | None) -> None:
    item = service.enqueue(
        text_ref="module:INS",
        deterministic_text=text,
        candidate_text=candidate,
        scanner=ForbiddenPhraseScanner(forbidden_phrases=[], blocked_claims=[]),
        model_id="gpt-6-luna",
        prompt_template_version=VERSION,
        prompt_template_id="rewrite_plain_language",
    )
    assert item is not None
    if status is not None:
        service.decide(item.item_id, status=status, reviewer_id="rev-1", reason="a recorded reason")


def _render(
    tmp_path: Path,
    content: ClinicalContentDTO,
    request: ReportRenderRequestDTO,
    service: ContentReviewService | None,
    *,
    enabled: bool = True,
) -> str:
    pipeline = RenderService(
        content_provider=_FakeContent(content),
        pdf_renderer=_FakePdf(),
        storage=LocalStorageBackend(root=tmp_path, base_url="http://x/reports"),
        signed_url_ttl=timedelta(minutes=15),
        ai_rewrite_enabled=enabled,
        review=None if service is None else _Wording(service),
    )
    ref = pipeline.render(request)
    return (tmp_path / ref.report_id / request.locale / "report.html").read_text("utf-8")


def _stored(root: Path) -> str:
    return "".join(
        path.read_bytes().decode("utf-8", errors="ignore")
        for path in root.rglob("*")
        if path.is_file()
    )


class TestUnapprovedWordingNeverReachesAReport:
    def test_a_rejected_rewording_is_never_printed(
        self,
        tmp_path: Path,
        content: ClinicalContentDTO,
        make_request: RequestBuilder,
        make_review_service: Callable[[], ContentReviewService],
    ) -> None:
        service = make_review_service()
        _queue(service, INS_OUTPUT, REJECTED_INS, STATUS_REJECTED)
        request = make_request(locale="es", level="L4", routes=("INS",))

        html = _render(tmp_path, content, request, service)

        assert REJECTED_INS not in _stored(tmp_path)
        assert html == render_html(request, content).html

    def test_a_pending_rewording_is_never_printed(
        self,
        tmp_path: Path,
        content: ClinicalContentDTO,
        make_request: RequestBuilder,
        make_review_service: Callable[[], ContentReviewService],
    ) -> None:
        service = make_review_service()
        _queue(service, INS_OUTPUT, REJECTED_INS, None)
        request = make_request(locale="es", level="L4", routes=("INS",))

        html = _render(tmp_path, content, request, service)

        assert REJECTED_INS not in _stored(tmp_path)
        assert INS_OUTPUT in html

    def test_with_nothing_approved_the_report_prints_the_approved_original(
        self,
        tmp_path: Path,
        content: ClinicalContentDTO,
        make_request: RequestBuilder,
        make_review_service: Callable[[], ContentReviewService],
    ) -> None:
        request = make_request(locale="es", level="L4", routes=("INS",))
        assert _render(tmp_path, content, request, make_review_service()) == (
            render_html(request, content).html
        )

    def test_without_the_queue_wired_the_report_is_deterministic(
        self, tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
    ) -> None:
        request = make_request(locale="es", level="L4", routes=("INS",))
        assert _render(tmp_path, content, request, None) == render_html(request, content).html

    def test_a_failing_queue_never_stops_or_changes_a_report(
        self, tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
    ) -> None:
        class _Broken:
            def approved_rewrite(self, deterministic_text: str) -> str | None:
                raise RuntimeError("database unavailable")

        request = make_request(locale="es", level="L4", routes=("INS",))
        pipeline = RenderService(
            content_provider=_FakeContent(content),
            pdf_renderer=_FakePdf(),
            storage=LocalStorageBackend(root=tmp_path, base_url="http://x/reports"),
            signed_url_ttl=timedelta(minutes=15),
            ai_rewrite_enabled=True,
            review=_Broken(),
        )
        ref = pipeline.render(request)
        stored = (tmp_path / ref.report_id / "es" / "report.html").read_text("utf-8")
        assert stored == render_html(request, content).html


class TestAnApprovedRewordingIsPrinted:
    def test_in_place_of_the_original_with_level_and_routing_unchanged(
        self,
        tmp_path: Path,
        content: ClinicalContentDTO,
        make_request: RequestBuilder,
        make_review_service: Callable[[], ContentReviewService],
    ) -> None:
        service = make_review_service()
        _queue(service, INS_OUTPUT, APPROVED_INS, STATUS_APPROVED)
        request = make_request(locale="es", level="L4", routes=("INS",))

        html = _render(tmp_path, content, request, service)

        assert APPROVED_INS in html
        assert INS_OUTPUT not in html
        # The decision is Morpheo's: same level name, same pattern name.
        assert "Información y observación" in html or "L4" in html
        assert "Dificultad para dormir" in html

    def test_but_not_when_ai_wording_is_switched_off(
        self,
        tmp_path: Path,
        content: ClinicalContentDTO,
        make_request: RequestBuilder,
        make_review_service: Callable[[], ContentReviewService],
    ) -> None:
        service = make_review_service()
        _queue(service, INS_OUTPUT, APPROVED_INS, STATUS_APPROVED)
        request = make_request(locale="es", level="L4", routes=("INS",))

        html = _render(tmp_path, content, request, service, enabled=False)

        assert html == render_html(request, content).html

    def test_urgent_instructions_are_never_reworded_even_if_approved(
        self,
        tmp_path: Path,
        content: ClinicalContentDTO,
        make_request: RequestBuilder,
        make_review_service: Callable[[], ContentReviewService],
    ) -> None:
        service = make_review_service()
        _queue(service, L1_ACTION, "Mejor no conduzcas hoy, si puedes.", STATUS_APPROVED)
        request = make_request(locale="es", level="L1", routes=())

        html = _render(tmp_path, content, request, service)

        assert L1_ACTION in html
        assert "Mejor no conduzcas hoy" not in html


def test_ai_wording_ships_switched_on() -> None:
    """Owner decision 2026-10-16: on everywhere; safe because of the tests above."""
    assert Settings().ai_rewrite_enabled is True
