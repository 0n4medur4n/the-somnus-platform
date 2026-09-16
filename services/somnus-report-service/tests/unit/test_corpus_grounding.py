"""Index B grounding, and what it may never touch (Addendum B §B3.1, 16.4).

Checkpoint 11.3 Stage 4 proved the citation resolves from the rule that fired
rather than from a similarity ranking. This checkpoint adds a second index beside
it, and the question that matters is what that addition can break.

§B3.1's answer is categorical: "a missing or empty enrichment degrades the
richness of the explanation and nothing else... **The citation itself always
resolves from Index A**, so an empty Index B can never produce a report with a
missing or wrong citation."

The proof below has the same shape as the Stage 4 determinism proof. One request,
rendered under four conditions of Index B — empty, fully populated, returning
material for the wrong scopes, and raising — with the level, the routes and the
citation block compared byte for byte across all four.

That property is not only tested, it is structural: Index B returns
`GroundingMaterial` and the citation block renders `RetrievedSource`. There is no
function anywhere in `report.corpus` that produces the latter, so no state of
Index B has a path to a citation. The test is here because structure can be
refactored away and a byte comparison notices.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path

import pytest

from report.application.render_service import RenderService
from report.application.retrieval import CitationResolver
from report.corpus.repository import CorpusChunk, DocumentScope, ScopedDocument
from report.corpus.retrieval import CorpusRetriever
from report.infrastructure.llm.provider import EmbeddingRequest, EmbeddingResponse
from report.infrastructure.storage import LocalStorageBackend
from report.schemas.render import ClinicalContentDTO, ReportRenderRequestDTO
from report.schemas.retrieval import (
    CorpusEntry,
    GroundingMaterial,
    GroundingRequest,
    RetrievalQuery,
)

RequestBuilder = Callable[..., ReportRenderRequestDTO]

# Transcribed from the shared content fixture, so this suite can disagree with it.
LEVEL_L4_NAME = "Información y observación"
MODULE_INS_NAME = "Dificultad para dormir"
MODULE_SLP_NAME = "Somnolencia diurna"

# Index A, as Stage 4 left it: SAFE-006 cites SRC-02 and SRC-03; SRC-01 is cited
# by no rule and must never appear on a report that fired SAFE-006.
INDEX_A = [
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


def _index_a(_content_version: str) -> list[CorpusEntry]:
    return list(INDEX_A)


def _document(
    document_id: str,
    *,
    scope: DocumentScope,
    locale: str = "es",
    title: str = "Material",
    citation: str = "Material de apoyo",
    text: str = "Un párrafo de apoyo.",
    vector: list[float] | None = None,
    version: int = 1,
) -> ScopedDocument:
    return ScopedDocument(
        id=document_id,
        title=title,
        citation=citation,
        locale=locale,
        corpus_version_added=version,
        matched_scopes=(scope,),
        chunks=(
            CorpusChunk(id=f"{document_id}-c0", chunk_index=0, text=text, vector=vector or []),
        ),
    )


class _FakePdf:
    def to_pdf(self, html: str) -> bytes:
        return b"%PDF-1.7 fake " + str(len(html)).encode()


class _FakeContent:
    def __init__(self, content: ClinicalContentDTO) -> None:
        self._content = content

    def get_content(self) -> ClinicalContentDTO:
        return self._content


class _RecordingEmbedder:
    """Captures every input that would reach the embedding API."""

    def __init__(self, vector: list[float] | None = None) -> None:
        self.inputs: list[str] = []
        self._vector = vector or [0.0, 1.0]

    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        self.inputs.extend(request.inputs)
        return EmbeddingResponse(
            vectors=[list(self._vector) for _ in request.inputs], model=request.model
        )


# --- the four conditions of Index B -----------------------------------------


class _EmptyIndexB:
    def retrieve(self, request: GroundingRequest, queries: tuple = ()) -> list[GroundingMaterial]:
        return []


class _PopulatedIndexB:
    def retrieve(self, request: GroundingRequest, queries: tuple = ()) -> list[GroundingMaterial]:
        return [
            GroundingMaterial(
                document_id="doc-ins",
                title="Higiene del sueño",
                citation="The Somnus (2026). Guía interna de higiene del sueño.",
                locale=request.locale,
                corpus_version_added=4,
                matched_scope_type="module",
                matched_scope_key="INS",
                text="Un párrafo de apoyo.",
                score=0.9,
            )
        ]


class _WrongIndexB:
    """Returns material that looks like a citation and is not one.

    The nastiest of the four: this is Index B answering confidently with the id
    and citation of a source the fired rule did NOT cite. If Index B could reach
    the citation block, this is the condition that would corrupt it.
    """

    def retrieve(self, request: GroundingRequest, queries: tuple = ()) -> list[GroundingMaterial]:
        return [
            GroundingMaterial(
                document_id="SRC-01",
                title="Riemann D. European Insomnia Guideline.",
                citation="Riemann D. European Insomnia Guideline.",
                locale="de",
                corpus_version_added=None,
                matched_scope_type="module",
                matched_scope_key="BRE",
                text="Texto de otro ámbito.",
                score=1.0,
            )
        ]


class _FailingIndexB:
    def retrieve(self, request: GroundingRequest, queries: tuple = ()) -> list[GroundingMaterial]:
        raise RuntimeError("index B is down")


INDEX_B_CONDITIONS = [
    pytest.param(None, id="unwired"),
    pytest.param(_EmptyIndexB(), id="empty"),
    pytest.param(_PopulatedIndexB(), id="populated"),
    pytest.param(_WrongIndexB(), id="wrong-results"),
    pytest.param(_FailingIndexB(), id="throwing"),
]


def _service(tmp_path: Path, content: ClinicalContentDTO, grounding: object) -> RenderService:
    return RenderService(
        content_provider=_FakeContent(content),
        pdf_renderer=_FakePdf(),
        storage=LocalStorageBackend(root=tmp_path, base_url="http://x/reports"),
        signed_url_ttl=timedelta(minutes=15),
        citations=CitationResolver(_index_a),
        grounding=grounding,  # type: ignore[arg-type]
    )


def _html(tmp_path: Path, report_id: str, locale: str = "es") -> str:
    return (tmp_path / report_id / locale / "report.html").read_text(encoding="utf-8")


def _section(html: str, css_class: str) -> str:
    """One `<section class="...">` block, verbatim, or the empty string."""
    match = re.search(rf'<section class="{css_class}">.*?</section>', html, re.DOTALL)
    return match.group(0) if match else ""


# --- the proof --------------------------------------------------------------


@pytest.mark.parametrize("index_b", INDEX_B_CONDITIONS)
def test_the_citation_and_the_decision_are_byte_identical_whatever_index_b_does(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder, index_b: object
) -> None:
    """§B3.1's guarantee, under every state Index B can be in.

    The baseline is the report rendered with Index B unwired entirely — the state
    every environment is in today. Each condition must reproduce its level block,
    its routed-pattern block and its citation block exactly.
    """
    request = make_request(
        level="L4", routes=("INS",), role="professional", triggered_rules=("SAFE-006",)
    )

    baseline = _html(tmp_path, _service(tmp_path, content, None).render(request).report_id)
    actual = _html(tmp_path, _service(tmp_path, content, index_b).render(request).report_id)

    assert _section(actual, "sources") == _section(baseline, "sources")
    assert _section(actual, "care-level") == _section(baseline, "care-level")
    assert _section(actual, "patterns") == _section(baseline, "patterns")


@pytest.mark.parametrize("index_b", INDEX_B_CONDITIONS)
def test_the_citation_names_exactly_the_sources_the_rule_cited(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder, index_b: object
) -> None:
    """Not just "unchanged" — correct, in each condition."""
    ref = _service(tmp_path, content, index_b).render(
        make_request(
            level="L4", routes=("INS",), role="professional", triggered_rules=("SAFE-006",)
        )
    )
    sources = _section(_html(tmp_path, ref.report_id), "sources")

    assert "Kapur VK. Diagnostic Testing for Adult OSA." in sources
    assert "Morgenthaler TI. Practice Parameters." in sources
    # SRC-01 is cited by no rule. `_WrongIndexB` returns it by id and citation,
    # which is precisely the condition this assertion exists for.
    assert "Riemann D. European Insomnia Guideline." not in sources


@pytest.mark.parametrize("index_b", INDEX_B_CONDITIONS)
def test_the_level_and_routes_are_the_ones_morpheo_decided(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder, index_b: object
) -> None:
    """Not merely unchanged between conditions — right, in each of them.

    The level and the routing come from the deterministic engine and the report
    only lays them out (§5.6). This asserts the laid-out values, so a condition
    that silently rendered a different level would fail here rather than passing
    a comparison of two equally wrong outputs.
    """
    html = _html(
        tmp_path,
        _service(tmp_path, content, index_b)
        .render(
            make_request(
                level="L4", routes=("INS",), role="professional", triggered_rules=("SAFE-006",)
            )
        )
        .report_id,
    )

    care_level = _section(html, "care-level")
    patterns = _section(html, "patterns")
    assert LEVEL_L4_NAME in care_level
    assert MODULE_INS_NAME in patterns
    # SLP was not routed, so it is not laid out however much material mentions it.
    assert MODULE_SLP_NAME not in patterns


def test_grounding_material_renders_in_its_own_block_never_among_the_citations(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    """§B3.1's separation, visible in the output.

    Supporting material is background an admin published; a citation is evidence a
    rule named. Rendering them in one list would attribute a clinical decision to
    material no rule cited, which is the thing this whole phase is arranged to
    prevent.
    """
    ref = _service(tmp_path, content, _PopulatedIndexB()).render(
        make_request(
            level="L4", routes=("INS",), role="professional", triggered_rules=("SAFE-006",)
        )
    )
    html = _html(tmp_path, ref.report_id)

    supporting = _section(html, "supporting-material")
    assert "Guía interna de higiene del sueño" in supporting
    assert "Guía interna de higiene del sueño" not in _section(html, "sources")
    assert 'data-document-id="doc-ins"' in supporting
    # No `data-source-id` in the supporting block: it carries no SRC identity.
    assert "data-source-id" not in supporting


def test_a_non_professional_report_gets_no_grounding_at_all(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    """Same boundary the citations already have: professional output only."""
    ref = _service(tmp_path, content, _PopulatedIndexB()).render(
        make_request(level="L4", routes=("INS",), role="adult", triggered_rules=("SAFE-006",))
    )
    html = _html(tmp_path, ref.report_id)
    assert _section(html, "supporting-material") == ""
    assert _section(html, "sources") == ""


# --- scope isolation (§B3) ---------------------------------------------------

SCOPED_CORPUS = {
    ("es", ("module", "INS")): _document("d-ins", scope=DocumentScope("module", "INS")),
    ("es", ("module", "BRE")): _document("d-bre", scope=DocumentScope("module", "BRE")),
    ("es", ("safety_rule", "SAFE-006")): _document(
        "d-safe006", scope=DocumentScope("safety_rule", "SAFE-006")
    ),
    ("es", ("safety_rule", "SAFE-001")): _document(
        "d-safe001", scope=DocumentScope("safety_rule", "SAFE-001")
    ),
    ("es", ("clinical_source", "SRC-05")): _document(
        "d-src05", scope=DocumentScope("clinical_source", "SRC-05")
    ),
    ("es", ("clinical_source", "SRC-10")): _document(
        "d-src10", scope=DocumentScope("clinical_source", "SRC-10")
    ),
    ("ca", ("module", "INS")): _document(
        "d-ins-ca", scope=DocumentScope("module", "INS"), locale="ca"
    ),
}


def _scoped_loader(locale: str, scopes) -> list[ScopedDocument]:
    """A loader with the same contract the repository's query has.

    It answers with the documents matching BOTH the locale and one of the
    requested scopes — nothing else — because that is what
    `CorpusRepository.scoped_documents` does in SQL. A fake that filtered more
    loosely would let this suite pass while the real query leaked.
    """
    return [
        document
        for (doc_locale, scope_key), document in SCOPED_CORPUS.items()
        if doc_locale == locale
        and any((scope.scope_type, scope.scope_key) == scope_key for scope in scopes)
    ]


@pytest.mark.parametrize(
    "request_,expected",
    [
        pytest.param(
            GroundingRequest(locale="es", module_ids=("INS",)),
            ["d-ins"],
            id="INS-only-report-never-sees-BRE",
        ),
        pytest.param(
            GroundingRequest(locale="es", module_ids=("BRE",)),
            ["d-bre"],
            id="BRE-only-report-never-sees-INS",
        ),
        pytest.param(
            GroundingRequest(locale="es", source_ids=("SRC-10",)),
            ["d-src10"],
            id="a-report-citing-SRC-10-never-sees-SRC-05-enrichment",
        ),
        pytest.param(
            GroundingRequest(locale="es", source_ids=("SRC-05",)),
            ["d-src05"],
            id="a-report-citing-SRC-05-never-sees-SRC-10-enrichment",
        ),
        pytest.param(
            GroundingRequest(locale="es", rule_ids=("SAFE-006",)),
            ["d-safe006"],
            id="a-rule-scoped-document-follows-the-rule-that-fired",
        ),
        pytest.param(
            GroundingRequest(
                locale="es", module_ids=("INS",), rule_ids=("SAFE-006",), source_ids=("SRC-05",)
            ),
            ["d-ins", "d-safe006", "d-src05"],
            id="everything-activated-and-nothing-else",
        ),
        pytest.param(
            GroundingRequest(locale="es"),
            [],
            id="a-result-that-activated-nothing-grounds-on-nothing",
        ),
    ],
)
def test_retrieval_is_restricted_to_the_scopes_the_result_activated(
    request_: GroundingRequest, expected: list[str]
) -> None:
    retrieved = CorpusRetriever(_scoped_loader).retrieve(request_)
    assert sorted(material.document_id for material in retrieved) == sorted(expected)


def test_a_catalan_document_never_surfaces_in_a_spanish_report() -> None:
    """§B3: locale matters, and a fallback would have to be a logged decision."""
    spanish = CorpusRetriever(_scoped_loader).retrieve(
        GroundingRequest(locale="es", module_ids=("INS",))
    )
    catalan = CorpusRetriever(_scoped_loader).retrieve(
        GroundingRequest(locale="ca", module_ids=("INS",))
    )

    assert [material.document_id for material in spanish] == ["d-ins"]
    assert [material.document_id for material in catalan] == ["d-ins-ca"]
    # Not "sorted last": absent. There is no silent fallback to another locale.
    assert "d-ins-ca" not in [material.document_id for material in spanish]


def test_a_wrong_vector_can_reorder_the_scoped_set_but_never_widen_it() -> None:
    """The filter comes first, and that is what makes ranking safe.

    The embedder here returns a vector pointing at the BRE document's direction.
    If ranking ran before scoping, BRE material would win an INS-only report. It
    cannot, because the loader never handed it over.
    """
    in_scope = [
        _document("d-ins-a", scope=DocumentScope("module", "INS"), vector=[1.0, 0.0]),
        _document("d-ins-b", scope=DocumentScope("module", "INS"), vector=[0.0, 1.0]),
    ]
    retriever = CorpusRetriever(
        lambda _locale, _scopes: list(in_scope),
        embedder=_RecordingEmbedder(vector=[0.0, 1.0]),
        model="text-embedding-3-large",
        dimensions=2,
    )

    ranked = retriever.retrieve(
        GroundingRequest(locale="es", module_ids=("INS",)),
        (RetrievalQuery(module_id="INS", text="Insomnio"),),
    )

    # Reordered: the better match first, rather than the loader's order.
    assert [material.document_id for material in ranked] == ["d-ins-b", "d-ins-a"]
    # And still only what the loader returned.
    assert {material.document_id for material in ranked} == {"d-ins-a", "d-ins-b"}


def test_an_unembedded_corpus_still_answers_in_a_stable_order() -> None:
    documents = [
        _document("d-2", scope=DocumentScope("module", "INS"), version=2),
        _document("d-1", scope=DocumentScope("module", "INS"), version=1),
    ]
    retriever = CorpusRetriever(lambda _locale, _scopes: list(documents))

    first = retriever.retrieve(GroundingRequest(locale="es", module_ids=("INS",)))
    second = retriever.retrieve(GroundingRequest(locale="es", module_ids=("INS",)))

    assert [m.document_id for m in first] == [m.document_id for m in second] == ["d-2", "d-1"]


def test_the_cap_holds_however_much_material_a_scope_has() -> None:
    documents = [
        _document(f"d-{index}", scope=DocumentScope("module", "INS")) for index in range(10)
    ]
    retrieved = CorpusRetriever(lambda _locale, _scopes: list(documents), top_k=3).retrieve(
        GroundingRequest(locale="es", module_ids=("INS",))
    )
    assert len(retrieved) == 3
