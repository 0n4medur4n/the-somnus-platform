"""PDF rendering (build plan §5.6 / §20 Checkpoint 11.1: PDF via WeasyPrint).

Behind a `PdfRenderer` protocol so the render pipeline is testable without the
heavy native stack. WeasyPrint needs system libraries (Pango/Cairo/GDK-PixBuf),
so its adapter imports it lazily and is exercised in CI (Linux) — local dev on a
box without those libraries uses a fake in tests.
"""

from __future__ import annotations

from typing import Protocol


class PdfRenderer(Protocol):
    def to_pdf(self, html: str) -> bytes: ...


class WeasyPrintPdfRenderer:
    """Renders HTML to PDF bytes with WeasyPrint. Deterministic given the same
    HTML; it never alters the content, only paginates it."""

    def to_pdf(self, html: str) -> bytes:
        # Lazy import: WeasyPrint's native deps may be absent where the rest of
        # the service still needs to run (local Windows dev). Import errors here
        # are a deployment/config problem, surfaced only when a PDF is requested.
        from weasyprint import HTML

        pdf: bytes = HTML(string=html).write_pdf()
        return pdf
