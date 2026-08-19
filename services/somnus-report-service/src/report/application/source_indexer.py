"""Indexes the approved clinical-source corpus for grounding (build plan §3.6b).

A batch operation (deploy/admin, never at request time): fetch the approved SRC
corpus from Morpheo, embed ONLY its approved text — the citation and the
clinical-use description — and persist the vectors in `somnus_reporting`.

No PII and no health free-text is ever embedded: the indexer works over the static
approved corpus, decoupled from any assessment, and never sees patient data. This
is outside the clinical decision path (§14b); retrieval (Stage 4) attaches these
sources to decisions the deterministic engine already made, never makes them.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from report.infrastructure.llm.provider import EmbeddingProvider, EmbeddingRequest
from report.infrastructure.sources_client import SourcesProvider
from report.schemas.sources import ClinicalSourceDTO, EmbeddedSourceDTO


class SourcesWriter(Protocol):
    def replace_embedded(
        self, content_version: str, embedded: list[EmbeddedSourceDTO], model: str
    ) -> None: ...


def embedding_text(source: ClinicalSourceDTO) -> str:
    """The ONLY text ever embedded for a source: its approved corpus fields."""
    return f"{source.citation}\n{source.use}"


@dataclass(frozen=True)
class IndexResult:
    content_version: str
    indexed: int
    model: str


class SourceIndexer:
    def __init__(
        self,
        provider: SourcesProvider,
        embedder: EmbeddingProvider,
        repository: SourcesWriter,
        *,
        model: str,
        dimensions: int,
    ) -> None:
        self._provider = provider
        self._embedder = embedder
        self._repository = repository
        self._model = model
        self._dimensions = dimensions

    def index(self) -> IndexResult:
        corpus = self._provider.get_sources()
        texts = [embedding_text(source) for source in corpus.sources]
        response = self._embedder.embed(
            EmbeddingRequest(inputs=texts, model=self._model, dimensions=self._dimensions)
        )
        if len(response.vectors) != len(corpus.sources):
            raise ValueError("embedding count does not match the source count")
        embedded = [
            EmbeddedSourceDTO(source=source, vector=vector)
            for source, vector in zip(corpus.sources, response.vectors, strict=True)
        ]
        self._repository.replace_embedded(corpus.content_version, embedded, response.model)
        return IndexResult(
            content_version=corpus.content_version,
            indexed=len(embedded),
            model=response.model,
        )
