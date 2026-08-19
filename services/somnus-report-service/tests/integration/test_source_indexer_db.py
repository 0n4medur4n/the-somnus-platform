"""The indexer persists embeddings into `somnus_reporting` (build plan §3.6b).

Uses a fake embedder (no live OpenAI) and the real repository + DB, so the vector
JSON round-trips through MySQL. Runs in CI where MySQL is provisioned.
"""

from __future__ import annotations

import json

from sqlalchemy import Engine
from sqlalchemy.orm import Session

from report.application.source_indexer import SourceIndexer
from report.infrastructure.llm.provider import EmbeddingRequest, EmbeddingResponse
from report.infrastructure.models import ClinicalSourceRow
from report.repositories.sources_repository import SourcesRepository
from report.schemas.sources import ClinicalSourceDTO, ClinicalSourcesDTO

_SOURCES = [
    ClinicalSourceDTO(id="SRC-01", citation="Riemann D.", url="https://x/1", use="Insomnio."),
    ClinicalSourceDTO(id="SRC-02", citation="Kapur VK.", url="https://x/2", use="AOS."),
]


class _FakeSources:
    def get_sources(self) -> ClinicalSourcesDTO:
        return ClinicalSourcesDTO(content_version="1.3", sources=_SOURCES)


class _FakeEmbedder:
    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        vectors = [[0.1, 0.2, 0.3] for _ in request.inputs]
        return EmbeddingResponse(vectors=vectors, model="text-embedding-3-large")


def test_indexer_stores_embeddings_that_round_trip_through_mysql(engine: Engine) -> None:
    with Session(engine) as session:
        session.query(ClinicalSourceRow).delete()
        session.commit()

        repository = SourcesRepository(session)
        result = SourceIndexer(
            _FakeSources(),
            _FakeEmbedder(),
            repository,
            model="text-embedding-3-large",
            dimensions=3072,
        ).index()
        session.commit()

        assert result.indexed == 2
        rows = repository.list_version("1.3")
        assert [row.source_id for row in rows] == ["SRC-01", "SRC-02"]
        assert rows[0].embedding_model == "text-embedding-3-large"
        # The vector round-tripped through the LONGTEXT column as JSON.
        assert json.loads(rows[0].embedding or "[]") == [0.1, 0.2, 0.3]

        session.query(ClinicalSourceRow).delete()
        session.commit()
