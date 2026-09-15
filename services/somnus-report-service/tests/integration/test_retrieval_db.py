"""Retrieval reads real embeddings from `somnus_reporting` (build plan §3.6b).

The VectorStore's corpus loader reads the stored vectors from MySQL and cosine
ranks them; a fake embedder supplies the query vector (no live OpenAI). Runs in CI.
"""

from __future__ import annotations

import json

from sqlalchemy import Engine
from sqlalchemy.orm import Session

from report.application.retrieval import CitationResolver, VectorStoreRetriever
from report.application.source_indexer import text_hash
from report.infrastructure.llm.provider import EmbeddingRequest, EmbeddingResponse
from report.infrastructure.models import ClinicalSourceRow
from report.repositories.sources_repository import SourcesRepository
from report.schemas.retrieval import CorpusEntry, RetrievalQuery
from report.schemas.sources import ClinicalSourceDTO, IndexedEntry

_SRC_01 = ClinicalSourceDTO("SRC-01", "Riemann D. Insomnia.", "u1", "Insomnio.", ())
_SRC_02 = ClinicalSourceDTO("SRC-02", "Kapur VK. OSA.", "u2", "AOS.", ("SAFE-006",))
_EMBEDDED = [
    IndexedEntry(_SRC_01, text_hash(_SRC_01), [1.0, 0.0]),
    IndexedEntry(_SRC_02, text_hash(_SRC_02), [0.0, 1.0]),
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
        SourcesRepository(session).write_indexed("1.3", _EMBEDDED, "text-embedding-3-large")
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


def test_the_rule_mapping_round_trips_and_resolves_by_id(engine: Engine) -> None:
    """Checkpoint 11.3 Stage 4, against the real migrated schema.

    The by-id path is only as good as the column behind it, so this runs over
    MySQL rather than a fake loader: the mapping has to survive `write_indexed`
    and come back out of `list_version` intact, and the resolver has to pick the
    source the rule cited over the one that ranks highest.
    """
    with Session(engine) as session:
        session.query(ClinicalSourceRow).delete()
        session.commit()
        SourcesRepository(session).write_indexed("1.3", _EMBEDDED, "text-embedding-3-large")
        session.commit()

        rows = {row.source_id: row for row in SourcesRepository(session).list_version("1.3")}
        assert json.loads(rows["SRC-02"].cited_by_rules or "[]") == ["SAFE-006"]
        assert json.loads(rows["SRC-01"].cited_by_rules or "[]") == []

        def loader(content_version: str) -> list[CorpusEntry]:
            return [
                CorpusEntry(
                    row.source_id,
                    row.citation,
                    row.url,
                    json.loads(row.embedding or "[]"),
                    tuple(json.loads(row.cited_by_rules or "[]")),
                )
                for row in SourcesRepository(session).list_version(content_version)
            ]

        resolved = CitationResolver(loader).resolve("1.3", ["SAFE-006"])
        assert [source.source_id for source in resolved] == ["SRC-02"]
        assert resolved[0].resolved_by == "rule"

        # And the source that would have won on similarity is NOT cited.
        ranked = VectorStoreRetriever(
            _FakeEmbedder([0.9, 0.1]), loader, model="text-embedding-3-large", dimensions=3072
        ).retrieve("1.3", [RetrievalQuery("INS", "Dificultad para dormir")])
        assert [source.source_id for source in ranked] == ["SRC-01"]

        session.query(ClinicalSourceRow).delete()
        session.commit()
