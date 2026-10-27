"""Verbatim passages for the professional's page: found by similarity, shown as they are."""

from __future__ import annotations

from typing import Any

from report.application.funnel_passages import MAX_EXCERPT, MAX_PASSAGES, FunnelPassages, excerpt
from report.application.funnel_report import FunnelReportService
from report.rendering.funnel_renderer import render_funnel_html
from report.schemas.render import FunnelReportGroundingDTO, FunnelReportRequestDTO
from report.schemas.retrieval import GroundingMaterial, GroundingRequest, RetrievalQuery

TEXTS = [{"template": "T_INSOMNIO", "text": "Nos ha contado que se despierta varias veces."}]
REPORT: dict[str, Any] = {
    "layout": "standard",
    "headline": ["Le proponemos una terapia específica para el insomnio, llamada TCC-I."],
    "secondary": [],
    "summary": "se despierta varias veces por la noche.",
    "steps": ["Diario 7-14 días y revisión propuesta a las 2-4 semanas."],
    "help": {
        "sentences": ["Si siente que el peligro es inmediato, llame al 112."],
        "resources": [],
    },
    "limits": ["No es un diagnóstico."],
    "sources": [],
    "professional": {
        "mainAction": "TERAPIA",
        "associatedActions": [],
        "templates": ["T_INSOMNIO"],
        "rules": ["R04 insomnio persistente"],
        "flags": [],
        "alerts": [],
        "pendingData": [],
        "safety": [],
        "answers": [],
        "narrative": None,
    },
}


class _FakePdf:
    def __init__(self) -> None:
        self.html: str | None = None

    def to_pdf(self, document: str) -> bytes:
        self.html = document
        return b"%PDF-1.7 fake"


GROUNDING = FunnelReportGroundingDTO(
    source_ids=["SRC-01", "SRC-14"],
    queries=["Le proponemos una terapia específica para el insomnio, llamada TCC-I."],
)


def _material(doc: str, score: float, text: str = "CBT-I is recommended.") -> GroundingMaterial:
    return GroundingMaterial(
        document_id=doc,
        title=f"Title {doc}",
        citation=f"Citation {doc}",
        locale="en",
        corpus_version_added=1,
        matched_scope_type="clinical_source",
        matched_scope_key="SRC-01",
        text=text,
        score=score,
    )


class _Retriever:
    def __init__(self, materials: list[GroundingMaterial] | Exception) -> None:
        self.materials = materials
        self.calls: list[tuple[GroundingRequest, tuple[RetrievalQuery, ...]]] = []

    def retrieve(
        self, request: GroundingRequest, queries: tuple[RetrievalQuery, ...] = ()
    ) -> list[GroundingMaterial]:
        self.calls.append((request, queries))
        if isinstance(self.materials, Exception):
            raise self.materials
        return self.materials


def _finder(materials: list[GroundingMaterial] | Exception, min_score: float = 0.3) -> Any:
    return FunnelPassages(_Retriever(materials), min_score=min_score)  # type: ignore[arg-type]


def test_it_searches_only_the_named_sources_with_the_approved_sentences() -> None:
    retriever = _Retriever([_material("a", 0.5)])
    FunnelPassages(retriever, min_score=0.3).find(GROUNDING)  # type: ignore[arg-type]
    request, queries = retriever.calls[0]
    assert request.source_ids == ("SRC-01", "SRC-14")
    assert request.module_ids == () and request.rule_ids == ()
    assert [q.text for q in queries] == GROUNDING.queries


def test_an_excerpt_below_the_threshold_is_left_out() -> None:
    found = _finder([_material("a", 0.55), _material("b", 0.12)]).find(GROUNDING)
    assert [p.title for p in found] == ["Title a"]


def test_the_best_match_comes_first_and_there_are_at_most_four() -> None:
    materials = [_material(str(i), 0.4 + i / 100) for i in range(8)]
    found = _finder(materials).find(GROUNDING)
    assert len(found) == MAX_PASSAGES
    assert [p.score for p in found] == sorted((p.score for p in found), reverse=True)
    assert found[0].title == "Title 7"


def test_the_text_is_the_librarys_own_with_only_whitespace_collapsed() -> None:
    original = "CBT-I   is the\nfirst-line  treatment."
    (found,) = _finder([_material("a", 0.6, original)]).find(GROUNDING)
    assert found.text == "CBT-I is the first-line treatment."


def test_a_long_excerpt_is_cut_at_a_word_and_stays_a_prefix() -> None:
    long = " ".join(["palabra"] * 400)
    shown = excerpt(long)
    assert len(shown) <= MAX_EXCERPT + 2 and shown.endswith(" …")
    assert long.startswith(shown.removesuffix(" …"))


def test_no_library_no_key_or_a_failure_means_no_excerpts_and_no_error() -> None:
    assert FunnelPassages(None, min_score=0.3).find(GROUNDING) == ()
    assert _finder([_material("a", 0.9)]).find(None) == ()
    assert _finder(RuntimeError("embedding provider down")).find(GROUNDING) == ()


def _request() -> FunnelReportRequestDTO:
    body: dict[str, Any] = {
        "sessionId": "f-1",
        "locale": "es",
        "completedAt": "2026-10-27T10:00:00+00:00",
        "contentVersion": "2.0",
        "rulesVersion": "2.0",
        "texts": TEXTS,
        "instruments": [],
        "instrumentsNote": None,
        "report": {
            **REPORT,
            "professional": {
                **REPORT["professional"],
                "grounding": GROUNDING.model_dump(by_alias=True),
            },
        },
    }
    return FunnelReportRequestDTO.model_validate(body)


def test_the_third_page_shows_each_excerpt_with_its_document_and_only_when_there_are_some() -> None:
    found = _finder([_material("a", 0.6, "CBT-I <b>first</b>.")]).find(GROUNDING)
    document = render_funnel_html(_request(), found)
    assert 'class="page-three"' in document
    assert "«CBT-I &lt;b&gt;first&lt;/b&gt;.»" in document  # escaped, not interpreted
    assert "Title a · Citation a" in document
    assert 'class="page-three"' not in render_funnel_html(_request())


def test_the_service_renders_the_pdf_even_when_the_search_fails() -> None:
    fake = _FakePdf()
    service = FunnelReportService(fake, _finder(RuntimeError("down")))
    pdf = service.render_pdf(_request())
    assert pdf.template_version == "report_v3"
    assert fake.html is not None and 'class="page-three"' not in fake.html


def test_the_service_hands_the_found_excerpts_to_the_page() -> None:
    fake = _FakePdf()
    FunnelReportService(fake, _finder([_material("a", 0.6)])).render_pdf(_request())
    assert fake.html is not None and "CBT-I is recommended." in fake.html


def test_a_request_without_grounding_searches_nothing() -> None:
    retriever = _Retriever([_material("a", 0.9)])
    request = FunnelReportRequestDTO.model_validate(
        {
            "sessionId": "f-1",
            "locale": "es",
            "completedAt": "2026-10-27T10:00:00+00:00",
            "contentVersion": "2.0",
            "rulesVersion": "2.0",
            "texts": TEXTS,
            "instruments": [],
            "instrumentsNote": None,
            "report": REPORT,
        }
    )
    FunnelReportService(_FakePdf(), FunnelPassages(retriever, min_score=0.3)).render_pdf(request)  # type: ignore[arg-type]
    assert retriever.calls == []


def test_the_excerpts_fit_one_extra_sheet_even_at_their_longest() -> None:
    """Four 1,000-character excerpts: patient, professional and excerpts sheets (WeasyPrint)."""
    try:
        from weasyprint import HTML
    except OSError as exc:  # native Pango/Cairo libraries not installed (local dev)
        import pytest

        pytest.skip(f"weasyprint native libraries unavailable: {exc}")
    longest = [_material(str(i), 0.9 - i / 10, " ".join(["recomendación"] * 120)) for i in range(4)]
    found = _finder(longest).find(GROUNDING)
    assert len(found) == 4
    assert len(HTML(string=render_funnel_html(_request(), found)).render().pages) == 3
