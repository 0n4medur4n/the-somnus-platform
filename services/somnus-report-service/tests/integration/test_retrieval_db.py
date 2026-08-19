"""Retrieval reads real embeddings from `somnus_reporting` (build plan §3.6b).

The VectorStore's corpus loader reads the stored vectors from MySQL and cosine
ranks them; a fake embedder supplies the query vector (no live OpenAI). Runs in CI.
"""

from __future__ import annotations

import json

from sqlalchemy import Engine
from sqlalchemy.orm import Session

from report.application.retrieval import VectorStoreRetriever
from report.infrastructure.llm.provider import EmbeddingRequest, EmbeddingResponse
from report.infrastructure.models import ClinicalSourceRow
from report.repositories.sources_repository import SourcesRepository
from report.schemas.retrieval import CorpusEntry, RetrievalQuery
from report.schemas.sources import ClinicalSourceDTO, EmbeddedSourceDTO

_EMBEDDED = [
    EmbeddedSourceDTO(
        ClinicalSourceDTO("SRC-01", "Riemann D. Insomnia.", "u1", "Insomnio."), [1.0, 0.0]
    ),
    EmbeddedSourceDTO(ClinicalSourceDTO("SRC-02", "Kapur VK. OSA.", "u2", "AOS."), [0.0, 1.0]),
]


class _FakeEmbedder:
    def __init__(self, vector: list[float]) -> None:
        self._vector = vector

    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        return EmbeddingResponse(
            vectors=[self._vector for _ in request.inputs], model=request.model
        )


def test_retrieval_reads_stored_vectors_and_ranks_by_cosine(engine: Engine) -> None:
    with Session(engine) as session:
        session.query(ClinicalSourceRow).delete()
        session.commit()
        SourcesRepository(session).replace_embedded("1.3", _EMBEDDED, "text-embedding-3-large")
        session.commit()

        def loader(content_version: str) -> list[CorpusEntry]:
            rows = SourcesRepository(session).list_version(content_version)
            return [
                CorpusEntry(row.source_id, row.citation, row.url, json.loads(row.embedding or "[]"))
                for row in rows
                if row.embedding
            ]

        retriever = VectorStoreRetriever(
            _FakeEmbedder([0.9, 0.1]), loader, model="text-embedding-3-large", dimensions=3072
        )
        results = retriever.retrieve("1.3", [RetrievalQuery("INS", "Dificultad para dormir")])
        assert [source.source_id for source in results] == ["SRC-01"]
        assert results[0].citation == "Riemann D. Insomnia."

        session.query(ClinicalSourceRow).delete()
        session.commit()
