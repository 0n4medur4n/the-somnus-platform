"""What may reach the embedding API, and what may never (§B4 / §14b, 16.4).

Checkpoint 16.4 is the first time the corpus calls a third party on a person's
report being rendered, so this suite is about the request that leaves the
building. Two rules, asserted at the adapter boundary rather than at a UI or a
call site, because that is the only place every caller passes through:

* **Only approved text.** The corpus chunks an admin published and §B4's chunker
  capped, and the approved module NAMES used as query terms. No assessment data,
  no answers, no health free-text, no identifiers of any person.
* **Only righted text.** `CorpusEmbeddingGate` (16.2) is the sole route to the
  provider, so a document that could not be published cannot be embedded.

The last test is structural: it walks the corpus module's imports and asserts
that nothing in it constructs an `EmbeddingRequest` outside the gate. A future
caller that reached for the provider directly would bypass both rules, and a
scan notices that where a behavioural test would not.
"""

from __future__ import annotations

import ast
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path

import pytest

from report.application.render_service import RenderService
from report.application.retrieval import CitationResolver
from report.corpus.embedding_gate import CorpusEmbeddingGate
from report.corpus.indexer import CorpusIndexer
from report.corpus.repository import (
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    CorpusChunk,
    CorpusStateError,
    DocumentScope,
    ReferenceDocument,
    ScopedDocument,
)
from report.corpus.retrieval import CorpusRetriever
from report.corpus.rights import RightsError, build_evidence
from report.infrastructure.llm.provider import EmbeddingRequest, EmbeddingResponse
from report.infrastructure.storage import LocalStorageBackend
from report.schemas.render import ClinicalContentDTO, ReportRenderRequestDTO
from report.schemas.retrieval import CorpusEntry, GroundingRequest, RetrievalQuery

RequestBuilder = Callable[..., ReportRenderRequestDTO]

PACKAGE = Path(__file__).resolve().parents[2] / "src" / "report"

APPROVED_TEXT = "La higiene del sueño mejora la latencia de conciliación."
MODULE_INS_NAME = "Dificultad para dormir"

#: Everything about the person and their assessment. None of it may appear in any
#: input to the provider, in any call, on any path.
NEVER_EMBEDDED = [
    "assess-123",
    "2026-08-17T12:00:00Z",
    "SAFE-006",
    "L4",
]


class _RecordingEmbedder:
    def __init__(self) -> None:
        self.inputs: list[str] = []
        self.calls = 0

    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        self.calls += 1
        self.inputs.extend(request.inputs)
        return EmbeddingResponse(vectors=[[0.0, 1.0] for _ in request.inputs], model=request.model)


class _FakeRepository:
    """The slice of `CorpusRepository` the indexer touches."""

    def __init__(self, document: ReferenceDocument, texts: list[str]) -> None:
        self._document = document
        self._texts = texts
        self.stored: list[list[float]] = []

    def get(self, _document_id: str) -> ReferenceDocument:
        return self._document

    def chunk_texts(self, _document_id: str) -> list[str]:
        return list(self._texts)

    def store_embeddings(self, _document_id: str, vectors, *, model: str, dimensions: int) -> None:
        if len(vectors) != len(self._texts):
            raise CorpusStateError("partial embedding refused")
        self.stored = [list(vector) for vector in vectors]


def _document(
    *,
    status: str = STATUS_PUBLISHED,
    rights_status: str | None = "own_document",
    rights_evidence: str | None = None,
) -> ReferenceDocument:
    return ReferenceDocument(
        id="doc-1",
        title="Higiene del sueño",
        citation="The Somnus (2026).",
        source_type="guideline",
        locale="es",
        status=status,
        rights_status=rights_status,
        rights_evidence=rights_evidence,
        added_by="018f0000-0000-7000-8000-0000000000ab",
        corpus_version_added=1,
        corpus_version_retired=None,
        retired_reason=None,
        scopes=(DocumentScope("module", "INS"),),
        chunk_count=1,
    )


def _indexer(embedder: _RecordingEmbedder) -> CorpusIndexer:
    return CorpusIndexer(
        CorpusEmbeddingGate(embedder), model="text-embedding-3-large", dimensions=2
    )


# --- what the indexer sends -------------------------------------------------


def test_indexing_sends_the_approved_chunks_and_nothing_else() -> None:
    embedder = _RecordingEmbedder()
    repository = _FakeRepository(_document(), [APPROVED_TEXT])

    stored = _indexer(embedder).index(repository, "doc-1")  # type: ignore[arg-type]

    assert stored == 1
    assert embedder.inputs == [APPROVED_TEXT]
    assert repository.stored == [[0.0, 1.0]]


def test_an_unrighted_document_never_reaches_the_provider() -> None:
    """§B4 at the boundary: the gate refuses before the adapter is touched."""
    embedder = _RecordingEmbedder()
    repository = _FakeRepository(_document(rights_status=None), [APPROVED_TEXT])

    with pytest.raises(RightsError):
        _indexer(embedder).index(repository, "doc-1")  # type: ignore[arg-type]

    assert embedder.calls == 0
    assert embedder.inputs == []


def test_a_document_with_unevidenced_rights_never_reaches_the_provider() -> None:
    embedder = _RecordingEmbedder()
    repository = _FakeRepository(
        _document(rights_status="open_access", rights_evidence=build_evidence(licence="CC BY 4.0")),
        [APPROVED_TEXT],
    )

    with pytest.raises(RightsError):
        _indexer(embedder).index(repository, "doc-1")  # type: ignore[arg-type]

    assert embedder.calls == 0


def test_a_draft_is_never_indexed() -> None:
    """Publishing is the decision; indexing follows it, never precedes it.

    Embedding a draft would put text into a third party's hands that nobody had
    yet decided to publish — which is what §B4 makes a publish-time gate for.
    """
    embedder = _RecordingEmbedder()
    repository = _FakeRepository(_document(status=STATUS_DRAFT), [APPROVED_TEXT])

    with pytest.raises(CorpusStateError, match="only a published document"):
        _indexer(embedder).index(repository, "doc-1")  # type: ignore[arg-type]

    assert embedder.calls == 0


def test_a_provider_answering_with_another_model_stores_nothing() -> None:
    """Vectors from a different model are not comparable with the rest of Index B."""

    class _WrongModel(_RecordingEmbedder):
        def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
            super().embed(request)
            return EmbeddingResponse(vectors=[[0.0, 1.0]], model="text-embedding-3-small")

    embedder = _WrongModel()
    repository = _FakeRepository(_document(), [APPROVED_TEXT])

    with pytest.raises(CorpusStateError, match="not comparable"):
        _indexer(embedder).index(repository, "doc-1")  # type: ignore[arg-type]

    assert repository.stored == []


def test_a_document_with_no_text_costs_no_call() -> None:
    embedder = _RecordingEmbedder()
    repository = _FakeRepository(_document(), [])

    assert _indexer(embedder).index(repository, "doc-1") == 0  # type: ignore[arg-type]
    assert embedder.calls == 0


# --- what retrieval sends ----------------------------------------------------


def test_retrieval_embeds_approved_module_names_and_no_assessment_data(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    """A full professional render, with every provider input captured.

    This is the whole point of the suite: the report being rendered is about a
    person, and what leaves for the embedding API is a module name.
    """
    embedder = _RecordingEmbedder()
    scoped = ScopedDocument(
        id="d-ins",
        title="Higiene del sueño",
        citation="The Somnus (2026).",
        locale="es",
        corpus_version_added=1,
        matched_scopes=(DocumentScope("module", "INS"),),
        chunks=(CorpusChunk(id="c0", chunk_index=0, text=APPROVED_TEXT, vector=[0.0, 1.0]),),
    )
    retriever = CorpusRetriever(
        lambda _locale, _scopes: [scoped],
        embedder=embedder,
        model="text-embedding-3-large",
        dimensions=2,
    )
    service = RenderService(
        content_provider=_Content(content),
        pdf_renderer=_Pdf(),
        storage=LocalStorageBackend(root=tmp_path, base_url="http://x/reports"),
        signed_url_ttl=timedelta(minutes=15),
        citations=CitationResolver(lambda _v: [_ENTRY]),
        grounding=retriever,
    )

    service.render(
        make_request(
            level="L4", routes=("INS",), role="professional", triggered_rules=("SAFE-006",)
        )
    )

    # Exactly the approved module name. Not the assessment id, not the fired
    # rule, not the level, not a timestamp, not a word of free text.
    assert embedder.inputs == [MODULE_INS_NAME]
    joined = " ".join(embedder.inputs)
    for forbidden in NEVER_EMBEDDED:
        assert forbidden not in joined


def test_the_query_terms_are_the_same_approved_vocabulary_11_3_uses() -> None:
    embedder = _RecordingEmbedder()
    CorpusRetriever(
        lambda _locale, _scopes: [],
        embedder=embedder,
        model="text-embedding-3-large",
        dimensions=2,
    ).retrieve(
        GroundingRequest(locale="es", module_ids=("INS",)),
        (RetrievalQuery(module_id="INS", text=MODULE_INS_NAME),),
    )
    assert embedder.inputs == [MODULE_INS_NAME]


# --- structural: the gate is the only door ----------------------------------


def test_only_two_places_in_the_corpus_module_reach_the_provider_at_all() -> None:
    """A behavioural test cannot see a path nobody has written yet.

    Two kinds of text reach the provider and they are governed differently:

    * **Document text** — a corpus document's chunks. §B4 governs this, and
      `embedding_gate.py` is where the rights check and the per-status cap live.
      A module that built its own request would reach the provider with neither.
    * **Query terms** — module names from the approved clinical content, which
      carry no rights question because they are not corpus documents. Only
      `retrieval.py` sends these, and the tests above pin exactly what it sends.

    Note what is NOT on this list: `indexer.py`. It is the module that handles
    document text, and it holds no provider — it goes through the gate, which is
    the whole reason the gate exists.
    """
    allowed = {"embedding_gate.py", "retrieval.py"}
    offenders: list[str] = []

    for path in sorted((PACKAGE / "corpus").glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        builds = any(
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "EmbeddingRequest"
            for node in ast.walk(tree)
        )
        if builds and path.name not in allowed:
            offenders.append(path.name)

    assert offenders == [], (
        f"{offenders} build an EmbeddingRequest directly; corpus document text reaches "
        "the provider through CorpusEmbeddingGate or not at all (§B4)"
    )

    # And the module that handles document text specifically does not hold one.
    indexer_source = (PACKAGE / "corpus" / "indexer.py").read_text(encoding="utf-8")
    assert "EmbeddingRequest" not in indexer_source


_ENTRY = CorpusEntry(
    source_id="SRC-02",
    citation="Kapur VK. Diagnostic Testing for Adult OSA.",
    url="https://example.org/src-02",
    vector=[0.0, 1.0],
    cited_by_rules=("SAFE-006",),
)


class _Pdf:
    def to_pdf(self, html: str) -> bytes:
        return b"%PDF-1.7 fake"


class _Content:
    def __init__(self, content: ClinicalContentDTO) -> None:
        self._content = content

    def get_content(self) -> ClinicalContentDTO:
        return self._content
