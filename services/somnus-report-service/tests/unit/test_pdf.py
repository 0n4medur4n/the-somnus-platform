"""PDF rendering behind the interface (build plan §20 Checkpoint 11.1).

The real WeasyPrint path is verified in CI (Linux, with the Pango/Cairo system
libraries). Where those libraries are absent (local dev), the native test skips.
"""

from __future__ import annotations

import pytest

from report.infrastructure.pdf import PdfRenderer, WeasyPrintPdfRenderer


class _FakePdf:
    def to_pdf(self, html: str) -> bytes:
        return b"%PDF-1.7 fake"


def test_pdf_renderer_protocol_accepts_an_implementation() -> None:
    renderer: PdfRenderer = _FakePdf()
    assert renderer.to_pdf("<html></html>").startswith(b"%PDF")


def test_weasyprint_produces_pdf_bytes() -> None:
    try:
        pdf = WeasyPrintPdfRenderer().to_pdf("<html><body><h1>Hola</h1></body></html>")
    except OSError as exc:  # native Pango/Cairo libraries not installed (local dev)
        pytest.skip(f"weasyprint native libraries unavailable: {exc}")
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 500
