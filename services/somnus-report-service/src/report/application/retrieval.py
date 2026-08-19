"""Clinical grounding retrieval (build plan §20 Checkpoint 11.3 / §3.6b / §14b).

Explanation-only. For the professional output, retrieve the approved clinical
source(s) most similar to the routed content — by cosine similarity over the
embedded corpus — to attach accurate citation text. This is OUTSIDE the decision
path: it attaches sources to a decision the deterministic engine already made and
can never change the level, the routing, or any decision. Queries are built from
approved terms only (module names); no PII or health free-text is ever embedded.

The store is portable (cosine in Python over the JSON-stored vectors), so it runs
on MySQL and TiDB alike; a TiDB-native VECTOR index can accelerate it later.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Protocol

from report.infrastructure.llm.provider import EmbeddingProvider, EmbeddingRequest
from report.schemas.retrieval import CorpusEntry, RetrievalQuery, RetrievedSource

CorpusLoader = Callable[[str], list[CorpusEntry]]


class SourceRetriever(Protocol):
    def retrieve(
        self, content_version: str, queries: list[RetrievalQuery]
    ) -> list[RetrievedSource]: ...


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


class VectorStoreRetriever:
    def __init__(
        self,
        embedder: EmbeddingProvider,
        corpus_loader: CorpusLoader,
        *,
        model: str,
        dimensions: int,
        top_k: int = 1,
    ) -> None:
        self._embedder = embedder
        self._corpus_loader = corpus_loader
        self._model = model
        self._dimensions = dimensions
        self._top_k = top_k

    def retrieve(
        self, content_version: str, queries: list[RetrievalQuery]
    ) -> list[RetrievedSource]:
        corpus = self._corpus_loader(content_version)
        if not corpus or not queries:
            return []
        vectors = self._embedder.embed(
            EmbeddingRequest(
                inputs=[query.text for query in queries],
                model=self._model,
                dimensions=self._dimensions,
            )
        ).vectors
        results: list[RetrievedSource] = []
        seen: set[str] = set()
        for query_vector in vectors:
            scored = [(cosine_similarity(query_vector, entry.vector), entry) for entry in corpus]
            scored.sort(key=lambda pair: pair[0], reverse=True)
            for score, entry in scored[: self._top_k]:
                if entry.source_id in seen:
                    continue
                seen.add(entry.source_id)
                results.append(
                    RetrievedSource(
                        source_id=entry.source_id,
                        citation=entry.citation,
                        url=entry.url,
                        score=score,
                    )
                )
        return results
