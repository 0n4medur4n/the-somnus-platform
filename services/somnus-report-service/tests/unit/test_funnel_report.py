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


# --- the one-page report and the professional's page (report_v3) ---

REPORT: dict[str, Any] = {
    "layout": "standard",
    "headline": ["Le proponemos una terapia específica para el insomnio, llamada TCC-I."],
    "secondary": [],
    "summary": "se despierta varias veces por la noche; le ocurre 4 noches por semana.",
    "steps": ["Diario 7-14 días y revisión propuesta a las 2-4 semanas."],
    "help": {
        "sentences": ["Si siente que el peligro es inmediato, llame al 112."],
        "resources": [
            {"code": "S4_extra", "text": "024 (línea de atención a la conducta suicida)"}
        ],
    },
    "limits": ["No es un diagnóstico."],
    "sources": ["[1] Riemann et al. 2023"],
    "professional": {
        "mainAction": "TERAPIA",
        "associatedActions": [],
        "templates": ["T_INSOMNIO"],
        "rules": ["R04 insomnio persistente"],
        "flags": [{"id": "ADAPTAR_TERAPIA", "reasons": ["bipolaridad"]}],
        "alerts": [],
        "pendingData": [],
        "safety": [{"question": "¿Pensamientos de hacerse daño?", "answer": "No", "when": "end"}],
        "answers": [
            {"id": "Q03", "question": "¿Ronca?", "answer": "No lo sé", "origin": "answered"},
            {"id": "Q05", "question": "¿Desde cuándo?", "answer": "6 meses", "origin": "narrative"},
        ],
        "narrative": "Me despierto mucho por la noche.",
    },
}


def _report_request(**report: Any) -> FunnelReportRequestDTO:
    return _request(report={**REPORT, **report})


def test_without_the_report_block_the_v2_layout_is_used() -> None:
    assert 'class="most-important"' not in render_funnel_html(_request())


def test_the_one_page_report_has_its_blocks_in_order_and_morpheos_words() -> None:
    document = render_funnel_html(_report_request())
    order = ["most-important", "told", "guidance", "next", "help"]
    positions = [document.index(f'class="{name}"') for name in order]
    assert positions == sorted(positions)
    for sentence in (
        REPORT["headline"][0],
        REPORT["steps"][0],
        REPORT["help"]["sentences"][0],
        REPORT["limits"][0],
    ):
        assert html.escape(sentence, quote=False) in document
    assert "Se despierta varias veces" in document  # the Z1 summary continues a sentence


def test_an_urgent_report_is_only_the_urgent_message_and_the_limits() -> None:
    document = render_funnel_html(
        _request(
            texts=[{"template": "T_SEGURIDAD", "text": "Llame ahora al 112."}],
            report={
                **REPORT,
                "layout": "urgent",
                "headline": [],
                "summary": None,
                "steps": [],
                "sources": [],
                "professional": None,
                "help": {"sentences": [], "resources": []},
            },
        )
    )
    assert "Llame ahora al 112." in document
    for block in ("most-important", "told", "next", "page-two", "instruments"):
        assert f'class="{block}"' not in document and f'class="{block} ' not in document
    assert "No es un diagnóstico." in document


def test_the_professionals_page_shows_the_rules_the_origin_and_never_a_no_for_unknown() -> None:
    document = render_funnel_html(_report_request())
    assert 'class="page-two"' in document
    assert "R04 insomnio persistente" in document and "bipolaridad" in document
    assert "Del relato, confirmado" in document  # a data point taken from the free account
    assert "Respondido" not in document  # what the person answered carries no tag
    assert "No lo sé" in document
    assert "Me despierto mucho por la noche." in document
    assert "Lo que no se sabe nunca se cuenta como" in document


def test_the_report_text_is_escaped_not_interpreted() -> None:
    document = render_funnel_html(_report_request(headline=["<b>x</b>"], limits=["<i>y</i>"]))
    assert "<b>x</b>" not in document and "&lt;b&gt;x&lt;/b&gt;" in document
    assert "<i>y</i>" not in document


def test_the_one_page_report_is_deterministic_and_stamped_v3() -> None:
    assert render_funnel_html(_report_request()) == render_funnel_html(_report_request())
    pdf = FunnelReportService(_FakePdf()).render_pdf(_report_request())
    assert pdf.template_version == "report_v3"


def test_the_request_with_a_report_conforms_to_the_contract() -> None:
    schema = json.loads((SCHEMA / "FunnelReportRequest.json").read_text(encoding="utf-8"))
    request = _report_request()
    jsonschema.validate(request.model_dump(by_alias=True, mode="json"), schema)


def test_the_report_block_refuses_an_unknown_field() -> None:
    with pytest.raises(ValueError):
        _report_request(extra="x")


def test_weasyprint_renders_the_one_page_report() -> None:
    try:
        pdf = WeasyPrintPdfRenderer().to_pdf(render_funnel_html(_report_request()))
    except OSError as exc:  # native Pango/Cairo libraries not installed (local dev)
        pytest.skip(f"weasyprint native libraries unavailable: {exc}")
    assert pdf.startswith(b"%PDF") and len(pdf) > 1000


def test_a_heavy_report_still_fits_the_patients_page_and_the_professionals_page() -> None:
    """The longest real case (34 answers, two headline sentences): two pages, one each."""
    try:
        from weasyprint import HTML
    except OSError as exc:  # native Pango/Cairo libraries not installed (local dev)
        pytest.skip(f"weasyprint native libraries unavailable: {exc}")
    answers = [
        {
            "id": f"Q{i:02d}",
            "question": "¿Hay enfermedad cardiopulmonar, debilidad respiratoria o insomnio?",
            "answer": "6 noches por semana" if i % 2 else "No",
            "origin": "answered" if i % 3 else "narrative",
        }
        for i in range(2, 36)
    ]
    heavy = {
        **REPORT,
        "headline": [
            "Conviene estudiar su respiración y valorar a la vez una terapia para el insomnio."
        ],
        "secondary": ["Si le pasa conduciendo, no conduzca y busque ayuda médica con prioridad."],
        "professional": {**REPORT["professional"], "answers": answers},
    }
    request = _request(
        report=heavy,
        texts=[
            {
                "template": "T_COMBINADO",
                "text": "Ha contado dificultades persistentes para dormir. " * 3,
            }
        ],
    )
    pages = HTML(string=render_funnel_html(request)).render().pages
    assert len(pages) == 2
