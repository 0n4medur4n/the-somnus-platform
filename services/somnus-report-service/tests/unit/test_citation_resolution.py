"""By-id citation resolution (build plan §14b / §20 Checkpoint 11.3 Stage 4).

§14b promises a professional report retrieves "the approved clinical source that
the deterministic rule already cited". Until Stage 4 closed, nothing implemented
that: the report embedded the routed module's NAME and took the cosine top-1 over
the whole corpus. The level and the routing were never at risk — retrieval cannot
touch those — but the citation could name a source the fired rule did not cite,
which attributes a clinical decision to evidence that does not back it.

The regression test below is the one that matters. It builds a corpus where the
old lookup demonstrably picks the wrong source, proves it picks it, and then
proves the new path picks the one the rule actually named.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from pathlib import Path

from report.application.render_service import RenderService
from report.application.retrieval import CitationResolver, VectorStoreRetriever
from report.infrastructure.llm.provider import EmbeddingRequest, EmbeddingResponse
from report.infrastructure.storage import LocalStorageBackend
from report.schemas.render import ClinicalContentDTO, ReportRenderRequestDTO
from report.schemas.retrieval import CorpusEntry, RetrievalQuery

RequestBuilder = Callable[..., ReportRenderRequestDTO]

# The corpus the tests resolve against. The vectors are the crux of the
# regression case: SRC-01 sits closest to the query the old path builds from the
# module name, while SAFE-006 — the rule that fires — cites SRC-02 and SRC-03.
CORPUS = [
    CorpusEntry(
        source_id="SRC-01",
        citation="Riemann D. European Insomnia Guideline.",
        url="https://example.org/src-01",
        vector=[1.0, 0.0],
        cited_by_rules=(),
    ),
    CorpusEntry(
        source_id="SRC-02",
        citation="Kapur VK. Diagnostic Testing for Adult OSA.",
        url="https://example.org/src-02",
        vector=[0.0, 1.0],
        cited_by_rules=("SAFE-006",),
    ),
    CorpusEntry(
        source_id="SRC-03",
        citation="Morgenthaler TI. Practice Parameters.",
        url="https://example.org/src-03",
        vector=[0.0, 1.0],
        cited_by_rules=("SAFE-006", "SAFE-003"),
    ),
]

# What the old similarity path would embed the module name to. Closest to SRC-01.
QUERY_VECTOR = [1.0, 0.05]


def _loader(_content_version: str) -> list[CorpusEntry]:
    return list(CORPUS)


class _FakeEmbedder:
    """Returns the query vector above, whatever it is asked to embed."""

    def __init__(self) -> None:
        self.calls = 0

    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        self.calls += 1
        return EmbeddingResponse(
            vectors=[list(QUERY_VECTOR) for _ in request.inputs], model=request.model
        )


class _FakePdf:
    def to_pdf(self, html: str) -> bytes:
        return b"%PDF-1.7 fake " + str(len(html)).encode()


class _FakeContent:
    def __init__(self, content: ClinicalContentDTO) -> None:
        self._content = content

    def get_content(self) -> ClinicalContentDTO:
        return self._content


def _service(
    tmp_path: Path,
    content: ClinicalContentDTO,
    *,
    with_similarity: bool = True,
) -> RenderService:
    retriever = (
        VectorStoreRetriever(_FakeEmbedder(), _loader, model="text-embedding-3-large", dimensions=2)
        if with_similarity
        else None
    )
    return RenderService(
        content_provider=_FakeContent(content),
        pdf_renderer=_FakePdf(),
        storage=LocalStorageBackend(root=tmp_path, base_url="http://x/reports"),
        signed_url_ttl=timedelta(minutes=15),
        citations=CitationResolver(_loader),
        retriever=retriever,
    )


def _html(tmp_path: Path, report_id: str) -> str:
    return (tmp_path / report_id / "es" / "report.html").read_text(encoding="utf-8")


# --- the core proof ---------------------------------------------------------


def test_a_fired_rule_cites_exactly_the_sources_it_names() -> None:
    resolved = CitationResolver(_loader).resolve("1.2", ["SAFE-006"])

    # Exactly SRC-02 and SRC-03, by id. Not "a plausible source", not top-k.
    assert [source.source_id for source in resolved] == ["SRC-02", "SRC-03"]
    assert all(source.resolved_by == "rule" for source in resolved)
    # SRC-01 is cited by no rule and must not appear however similar it is.
    assert "SRC-01" not in [source.source_id for source in resolved]


def test_the_rendered_report_carries_those_citations_and_no_others(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    ref = _service(tmp_path, content).render(
        make_request(
            level="L4", routes=("INS",), role="professional", triggered_rules=("SAFE-006",)
        )
    )
    html = _html(tmp_path, ref.report_id)

    assert "Kapur VK. Diagnostic Testing for Adult OSA." in html
    assert "Morgenthaler TI. Practice Parameters." in html
    assert "Riemann D. European Insomnia Guideline." not in html


def test_two_rules_firing_resolve_the_union_once_each() -> None:
    resolved = CitationResolver(_loader).resolve("1.2", ["SAFE-003", "SAFE-006"])
    # SRC-03 is cited by both and must appear once, not twice.
    assert [source.source_id for source in resolved] == ["SRC-02", "SRC-03"]


# --- the regression proof ---------------------------------------------------


def test_the_old_similarity_path_would_have_cited_the_wrong_source(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    """The defect, demonstrated, then shown fixed.

    First half: the similarity lookup, run directly on this corpus, returns
    SRC-01 — a source SAFE-006 does not cite. That is what a professional report
    was rendered with before Stage 4 closed.

    Second half: the same assessment through the render path now cites SRC-02 and
    SRC-03, and SRC-01 appears nowhere.
    """
    similarity = VectorStoreRetriever(
        _FakeEmbedder(), _loader, model="text-embedding-3-large", dimensions=2
    )
    ranked = similarity.retrieve("1.2", [RetrievalQuery(module_id="INS", text="Insomnio")])
    assert [source.source_id for source in ranked] == ["SRC-01"]

    ref = _service(tmp_path, content).render(
        make_request(
            level="L4", routes=("INS",), role="professional", triggered_rules=("SAFE-006",)
        )
    )
    html = _html(tmp_path, ref.report_id)
    assert "Riemann D. European Insomnia Guideline." not in html
    assert "Kapur VK. Diagnostic Testing for Adult OSA." in html


def test_a_rule_cited_report_never_calls_the_embedder_at_all(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    # Asserted at the adapter boundary, not by timing: if the by-id path resolved
    # anything, the similarity path must not run — otherwise a corpus change
    # could start overriding a rule's own citation.
    embedder = _FakeEmbedder()
    service = RenderService(
        content_provider=_FakeContent(content),
        pdf_renderer=_FakePdf(),
        storage=LocalStorageBackend(root=tmp_path, base_url="http://x/reports"),
        signed_url_ttl=timedelta(minutes=15),
        citations=CitationResolver(_loader),
        retriever=VectorStoreRetriever(
            embedder, _loader, model="text-embedding-3-large", dimensions=2
        ),
    )
    service.render(
        make_request(
            level="L4", routes=("INS",), role="professional", triggered_rules=("SAFE-006",)
        )
    )
    assert embedder.calls == 0


# --- the fallback, and its boundaries ---------------------------------------


def test_a_report_that_fired_no_rule_falls_back_to_similarity(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    # Nothing to be exact about: no rule fired, so no rule named a source.
    ref = _service(tmp_path, content).render(
        make_request(level="L4", routes=("INS",), role="professional", triggered_rules=())
    )
    assert "Riemann D. European Insomnia Guideline." in _html(tmp_path, ref.report_id)


def test_by_id_resolution_works_with_no_embedder_configured(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    """§14b's guarantee must not depend on an OpenAI key being set.

    With no retriever wired at all, a rule-cited report still cites correctly —
    which is the reason the by-id resolver takes no embedder.
    """
    ref = _service(tmp_path, content, with_similarity=False).render(
        make_request(
            level="L4", routes=("INS",), role="professional", triggered_rules=("SAFE-006",)
        )
    )
    assert "Kapur VK. Diagnostic Testing for Adult OSA." in _html(tmp_path, ref.report_id)


def test_an_unknown_rule_resolves_to_nothing_rather_than_to_something_plausible() -> None:
    assert CitationResolver(_loader).resolve("1.2", ["SAFE-999"]) == []


def test_the_adult_report_is_never_cited_whatever_fired(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    # Grounding belongs to the professional output (§3.6b). The role gate runs
    # before either path.
    ref = _service(tmp_path, content).render(
        make_request(level="L4", routes=("INS",), role="adult", triggered_rules=("SAFE-006",))
    )
    assert 'class="sources"' not in _html(tmp_path, ref.report_id)
