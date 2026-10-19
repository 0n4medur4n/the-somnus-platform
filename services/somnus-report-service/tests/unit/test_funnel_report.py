"""The v2 report: morpheo's final text laid out, deterministically, no model."""

from __future__ import annotations

import base64
import html
import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from report.application.funnel_report import FunnelReportService
from report.infrastructure.pdf import WeasyPrintPdfRenderer
from report.rendering.funnel_renderer import TEMPLATE_VERSION_V2, render_funnel_html
from report.schemas.render import FunnelReportRequestDTO

SCHEMA = Path(__file__).resolve().parents[4] / "schemas" / "json-schema" / "report"

TEXTS = [
    {
        "template": "T_INSOMNIO",
        "text": "Nos ha contado que se despierta varias veces por la noche, 4 noches por semana"
        " y desde hace 6 meses, incluso cuando puede dormir.",
    },
    {
        "template": "T_HABITOS",
        "text": "Podemos empezar por proteger un tiempo fijo para descansar.",
    },
]
ISI = {
    "code": "ISI",
    "name": "Índice de Gravedad del Insomnio",
    "status": "completed",
    "total": 15,
    "band": "banda del manual",
    "placement": "v0.2 p. 5, I6",
}
NOTE = "Ninguna escala confirma apnea ni sustituye la entrevista."


def _request(**overrides: Any) -> FunnelReportRequestDTO:
    body: dict[str, Any] = {
        "sessionId": "f-1",
        "locale": "es",
        "completedAt": "2026-10-19T10:00:00+00:00",
        "contentVersion": "2.0",
        "rulesVersion": "2.0",
        "texts": TEXTS,
        "instruments": [],
        "instrumentsNote": None,
    }
    body.update(overrides)
    return FunnelReportRequestDTO.model_validate(body)


class _FakePdf:
    def __init__(self) -> None:
        self.html: str | None = None

    def to_pdf(self, document: str) -> bytes:
        self.html = document
        return b"%PDF-1.7 fake"


def test_the_same_result_renders_the_same_html() -> None:
    assert render_funnel_html(_request()) == render_funnel_html(_request())


def test_every_paragraph_is_morpheos_text_word_for_word() -> None:
    document = render_funnel_html(_request())
    for paragraph in TEXTS:
        assert html.escape(paragraph["text"], quote=False) in document
    assert document.count('class="paragraph"') == len(TEXTS)


def test_clinical_text_is_escaped_not_interpreted() -> None:
    document = render_funnel_html(
        _request(texts=[{"template": "T_X", "text": "<script>alert(1)</script>"}])
    )
    assert "<script>" not in document and "&lt;script&gt;" in document


def test_completed_scores_and_v02s_sentence_on_scales_are_shown() -> None:
    document = render_funnel_html(_request(instruments=[ISI], instrumentsNote=NOTE))
    assert "Índice de Gravedad del Insomnio" in document
    assert "15 puntos · banda del manual" in document
    assert NOTE in document


def test_no_instrument_section_without_a_completed_score() -> None:
    assert 'class="instruments"' not in render_funnel_html(_request())


def test_other_languages_say_the_guidance_is_in_spanish() -> None:
    english = render_funnel_html(_request(locale="en"))
    assert "Sleep guidance" in english and "in Spanish" in english
    assert 'class="language-note"' not in render_funnel_html(_request())


def test_the_service_returns_the_pdf_with_its_versions_and_keeps_nothing() -> None:
    fake = _FakePdf()
    pdf = FunnelReportService(fake).render_pdf(_request())
    assert base64.b64decode(pdf.pdf_base64).startswith(b"%PDF")
    assert (pdf.assessment_id, pdf.template_version) == ("f-1", TEMPLATE_VERSION_V2)
    assert (pdf.definition_version, pdf.content_version) == ("2.0", "2.0")
    assert fake.html == render_funnel_html(_request())


def test_the_request_and_response_conform_to_the_contract() -> None:
    def schema(name: str) -> dict[str, Any]:
        return json.loads((SCHEMA / f"{name}.json").read_text(encoding="utf-8"))

    request = _request(instruments=[ISI], instrumentsNote=NOTE)
    jsonschema.validate(
        request.model_dump(by_alias=True, mode="json"), schema("FunnelReportRequest")
    )
    pdf = FunnelReportService(_FakePdf()).render_pdf(request)
    jsonschema.validate(pdf.model_dump(by_alias=True, mode="json"), schema("ReportPdf"))


def test_weasyprint_renders_the_v2_report() -> None:
    try:
        pdf = WeasyPrintPdfRenderer().to_pdf(render_funnel_html(_request(instruments=[ISI])))
    except OSError as exc:  # native Pango/Cairo libraries not installed (local dev)
        pytest.skip(f"weasyprint native libraries unavailable: {exc}")
    assert pdf.startswith(b"%PDF") and len(pdf) > 1000
