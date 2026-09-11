"""Clinical grounding retrieval (build plan §20 Checkpoint 11.3 / §3.6b / §14b).

Explanation-only, and in two layers with a strict order of precedence.

**By id, first and normally the only one.** §14b promises the report retrieves
"the approved clinical source that the deterministic rule already cited", and
§B3.1 promises "the citation itself always resolves from Index A". Both mean the
same thing: the citation on a professional report is decided by the ARTIFACT, via
`safety_rules[].sources`, not by anything statistical. `CitationResolver` does
exactly that lookup and nothing else — no embedder, no API key, no network. Every
one of the nine safety rules names at least one source, so in practice a report
that fired a rule is always cited this way.

**By similarity, only where there is nothing to resolve.** A report can fire no
rule at all (a plain L4 with routed modules and no safety trigger). There is no
rule-cited source for those, so the older cosine lookup stays as the fallback,
unchanged: embed the routed module NAMES — approved terms, never PII or health
free-text — and rank the corpus.

Getting that order wrong is the defect this module was rewritten to fix. The
similarity lookup used to be the only path, which meant a report that fired
SAFE-006 (citing SRC-02, SRC-03, SRC-05) could be rendered citing SRC-01, because
SRC-01's text happened to sit closer to the module name in embedding space. The
report was not wrong about the level or the routing — retrieval can never touch
those — but it attributed a clinical decision to a source that did not back it.

Neither layer is inside the decision path. Both attach sources to a decision the
deterministic engine already made; any failure in either degrades the citation and
nothing else.

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


class CitationResolver:
    """Resolves the sources a fired rule cited, by id (Checkpoint 11.3 Stage 4).

    Deliberately shares nothing with the similarity path but the corpus loader.
    It takes no embedder and makes no call, so the guarantee §14b states holds in
    an environment with no OpenAI key at all — which is every environment where
    the key is unset, and would otherwise have meant no citations whatsoever.
    """

    def __init__(self, corpus_loader: CorpusLoader) -> None:
        self._corpus_loader = corpus_loader

    def resolve(self, content_version: str, rule_ids: list[str]) -> list[RetrievedSource]:
        if not rule_ids:
            return []
        fired = set(rule_ids)
        # Sorted by source id, so the same report cites in the same order every
        # time it is rendered. Ordering is part of identical-input/identical-output.
        cited = sorted(
            (
                entry
                for entry in self._corpus_loader(content_version)
                if fired.intersection(entry.cited_by_rules)
            ),
            key=lambda entry: entry.source_id,
        )
        return [
            RetrievedSource(
                source_id=entry.source_id,
                citation=entry.citation,
                url=entry.url,
                # Not ranked against anything: the rule named it.
                score=1.0,
                resolved_by="rule",
            )
            for entry in cited
        ]


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
        # Only embedded entries can be ranked. The loader is shared with the by-id
        # resolver, which wants every row whether it carries a vector or not, so
        # the filter belongs here rather than in the loader: an unembedded row
        # scores 0.0 against everything and would otherwise be a candidate for
        # top-1 in a corpus that had not finished indexing.
        corpus = [entry for entry in self._corpus_loader(content_version) if entry.vector]
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
