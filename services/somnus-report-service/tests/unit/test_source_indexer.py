"""The clinical-source indexer (build plan §3.6b / Checkpoint 11.3 Stage 3).

Proves the §14b/§3.6b guarantee: ONLY the approved corpus text (citation + use) is
ever embedded — no PII, no health free-text, nothing from any assessment.
"""

from __future__ import annotations

import pytest

from report.application.source_indexer import SourceIndexer, embedding_text
from report.infrastructure.llm.provider import EmbeddingRequest, EmbeddingResponse
from report.schemas.sources import ClinicalSourceDTO, ClinicalSourcesDTO, EmbeddedSourceDTO

_SOURCES = [
    ClinicalSourceDTO(
        id="SRC-01", citation="Riemann D, et al. Insomnia 2023.", url="https://x/1", use="Insomnio."
    ),
    ClinicalSourceDTO(
        id="SRC-02", citation="Kapur VK, et al. OSA.", url="https://x/2", use="Sospecha de AOS."
    ),
]


class _FakeSources:
    def get_sources(self) -> ClinicalSourcesDTO:
        return ClinicalSourcesDTO(content_version="1.3", sources=_SOURCES)


class _FakeEmbedder:
    def __init__(self) -> None:
        self.seen: EmbeddingRequest | None = None

    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        self.seen = request
        vectors = [[float(i), float(i) + 0.5] for i, _ in enumerate(request.inputs)]
        return EmbeddingResponse(vectors=vectors, model="text-embedding-3-large")


class _FakeRepo:
    def __init__(self) -> None:
        self.saved: tuple[str, list[EmbeddedSourceDTO], str] | None = None

    def replace_embedded(
        self, content_version: str, embedded: list[EmbeddedSourceDTO], model: str
    ) -> None:
        self.saved = (content_version, embedded, model)


def _indexer(embedder: _FakeEmbedder, repo: _FakeRepo) -> SourceIndexer:
    return SourceIndexer(
        _FakeSources(), embedder, repo, model="text-embedding-3-large", dimensions=3072
    )


def test_only_the_approved_corpus_text_is_embedded_never_pii_or_health() -> None:
    embedder = _FakeEmbedder()
    _indexer(embedder, _FakeRepo()).index()

    assert embedder.seen is not None
    # The embedder receives EXACTLY citation+use for each source and nothing else —
    # no patient data, no assessment answers, no query free-text.
    assert embedder.seen.inputs == [embedding_text(source) for source in _SOURCES]
    assert embedder.seen.model == "text-embedding-3-large"
    assert embedder.seen.dimensions == 3072


def test_index_persists_one_vector_per_source_with_the_model() -> None:
    embedder = _FakeEmbedder()
    repo = _FakeRepo()
    result = _indexer(embedder, repo).index()

    assert result.content_version == "1.3"
    assert result.indexed == 2
    assert result.model == "text-embedding-3-large"
    assert repo.saved is not None
    version, embedded, model = repo.saved
    assert version == "1.3"
    assert [entry.source.id for entry in embedded] == ["SRC-01", "SRC-02"]
    assert all(entry.vector for entry in embedded)
    assert model == "text-embedding-3-large"


class _ShortEmbedder:
    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        # One fewer vector than inputs: a provider fault must never persist a
        # misaligned corpus (a wrong citation on a source).
        return EmbeddingResponse(vectors=[[0.0]], model="text-embedding-3-large")


def test_index_refuses_when_the_embedding_count_does_not_match() -> None:
    repo = _FakeRepo()
    indexer = SourceIndexer(
        _FakeSources(), _ShortEmbedder(), repo, model="text-embedding-3-large", dimensions=3072
    )
    with pytest.raises(ValueError, match="does not match"):
        indexer.index()
    assert repo.saved is None
