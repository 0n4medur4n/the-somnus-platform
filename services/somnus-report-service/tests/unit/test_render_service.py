"""The render pipeline end to end with fakes (build plan §20 Checkpoint 11.1)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from pathlib import Path

import pytest

from report.application.ai_rewrite import AiRewriteDisabledError
from report.application.render_service import RenderService
from report.infrastructure.storage import LocalStorageBackend
from report.rendering.renderer import render_html
from report.schemas.render import ClinicalContentDTO, ReportRenderRequestDTO
from report.settings.config import Settings

RequestBuilder = Callable[..., ReportRenderRequestDTO]


class _FakeContent:
    def __init__(self, content: ClinicalContentDTO) -> None:
        self._content = content

    def get_content(self) -> ClinicalContentDTO:
        return self._content


class _FakePdf:
    def to_pdf(self, html: str) -> bytes:
        return b"%PDF-1.7 fake " + str(len(html)).encode()


def test_render_service_stores_html_pdf_and_returns_signed_urls(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    service = RenderService(
        content_provider=_FakeContent(content),
        pdf_renderer=_FakePdf(),
        storage=LocalStorageBackend(root=tmp_path, base_url="http://x/reports"),
        signed_url_ttl=timedelta(minutes=15),
    )
    ref = service.render(make_request(locale="es", level="L4", routes=("INS",)))

    assert ref.report_id
    assert ref.assessment_id == "assess-123"
    assert ref.template_version == "report_v1"
    assert ref.content_version == "1.2"

    html_path = tmp_path / ref.report_id / "es" / "report.html"
    pdf_path = tmp_path / ref.report_id / "es" / "report.pdf"
    assert html_path.read_text(encoding="utf-8").startswith("<!doctype html>")
    assert pdf_path.read_bytes().startswith(b"%PDF")

    assert ref.html_url is not None and "expires=" in ref.html_url
    assert ref.pdf_url is not None and "expires=" in ref.pdf_url
    assert LocalStorageBackend.is_expired(ref.pdf_url) is False


def test_ai_rewrite_is_disabled_by_default_and_when_env_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Unset AI_REWRITE_ENABLED must read as off — the master switch defaults off.
    monkeypatch.delenv("AI_REWRITE_ENABLED", raising=False)
    assert Settings().ai_rewrite_enabled is False


def test_ai_rewrite_off_stores_the_deterministic_html_byte_for_byte(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    # With the flag off (default), the report contains ONLY the deterministic
    # renderer output — no code path can inject AI-rewritten text.
    service = RenderService(
        content_provider=_FakeContent(content),
        pdf_renderer=_FakePdf(),
        storage=LocalStorageBackend(root=tmp_path, base_url="http://x/reports"),
        signed_url_ttl=timedelta(minutes=15),
    )
    request = make_request(locale="es", level="L4", routes=("INS",))
    ref = service.render(request)

    stored = (tmp_path / ref.report_id / "es" / "report.html").read_text(encoding="utf-8")
    assert stored == render_html(request, content).html


def test_ai_rewrite_on_refuses_to_serve_unreviewed_output(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    # Flipping the flag on cannot serve AI text while no human-review mechanism
    # exists (§15): the pipeline refuses rather than emit unreviewed output.
    service = RenderService(
        content_provider=_FakeContent(content),
        pdf_renderer=_FakePdf(),
        storage=LocalStorageBackend(root=tmp_path, base_url="http://x/reports"),
        signed_url_ttl=timedelta(minutes=15),
        ai_rewrite_enabled=True,
    )
    with pytest.raises(AiRewriteDisabledError):
        service.render(make_request(locale="es", level="L4", routes=("INS",)))
