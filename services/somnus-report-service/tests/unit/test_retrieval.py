"""Clinical-grounding retrieval (build plan §3.6b / §14b / Checkpoint 11.3 Stage 4)."""

from __future__ import annotations

from report.application.retrieval import VectorStoreRetriever, cosine_similarity
from report.infrastructure.llm.provider import EmbeddingRequest, EmbeddingResponse
from report.schemas.retrieval import CorpusEntry, RetrievalQuery

_CORPUS = [
    CorpusEntry(source_id="SRC-01", citation="Riemann D. Insomnia.", url="u1", vector=[1.0, 0.0]),
    CorpusEntry(source_id="SRC-02", citation="Kapur VK. OSA.", url="u2", vector=[0.0, 1.0]),
]


class _FakeEmbedder:
    def __init__(self, vector: list[float]) -> None:
        self._vector = vector
        self.seen: EmbeddingRequest | None = None

    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        self.seen = request
        return EmbeddingResponse(
            vectors=[self._vector for _ in request.inputs], model=request.model
        )


def test_cosine_similarity_basics() -> None:
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == 1.0
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0
    assert cosine_similarity([1.0, 0.0], [0.0, 0.0]) == 0.0  # zero vector, no div-by-zero
    assert cosine_similarity([1.0], [1.0, 0.0]) == 0.0  # length mismatch


def test_retrieves_the_nearest_source_and_embeds_only_approved_terms() -> None:
    embedder = _FakeEmbedder([0.9, 0.1])  # closest to SRC-01
    retriever = VectorStoreRetriever(
        embedder, lambda _cv: _CORPUS, model="text-embedding-3-large", dimensions=3072
    )
    results = retriever.retrieve(
        "1.3", [RetrievalQuery(module_id="INS", text="Dificultad para dormir")]
    )

    assert [source.source_id for source in results] == ["SRC-01"]
    assert results[0].citation == "Riemann D. Insomnia."
    # The ONLY thing embedded is the approved module term — never PII/health, and
    # via the provider abstraction (no direct SDK call).
    assert embedder.seen is not None
    assert embedder.seen.inputs == ["Dificultad para dormir"]
    assert embedder.seen.model == "text-embedding-3-large"
    assert embedder.seen.dimensions == 3072


def test_wrong_query_vector_retrieves_the_other_source() -> None:
    # A misbehaving embedding just changes WHICH citation is attached — never a
    # decision (that guarantee is proven in test_render_determinism).
    embedder = _FakeEmbedder([0.1, 0.9])  # now closest to SRC-02
    retriever = VectorStoreRetriever(
        embedder, lambda _cv: _CORPUS, model="text-embedding-3-large", dimensions=3072
    )
    results = retriever.retrieve("1.3", [RetrievalQuery(module_id="BRE", text="Respiración")])
    assert [source.source_id for source in results] == ["SRC-02"]


def test_empty_corpus_returns_no_citations() -> None:
    embedder = _FakeEmbedder([1.0, 0.0])
    retriever = VectorStoreRetriever(
        embedder, lambda _cv: [], model="text-embedding-3-large", dimensions=3072
    )
    assert retriever.retrieve("1.3", [RetrievalQuery(module_id="INS", text="x")]) == []
    # No corpus -> nothing embedded either.
    assert embedder.seen is None
