"""The render pipeline end to end with fakes (build plan §20 Checkpoint 11.1)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from pathlib import Path

from report.application.render_service import RenderService
from report.infrastructure.storage import LocalStorageBackend
from report.schemas.render import ClinicalContentDTO, ReportRenderRequestDTO

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
