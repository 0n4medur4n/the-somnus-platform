"""Index B retrieval: scoped, locale-exact grounding material (§B3 / §B3.1, 16.4).

This is the second of the two indexes §B2a describes, and everything it returns is
*supporting material* — never a citation. That distinction is load-bearing and it
is enforced by shape rather than by discipline: this module returns
`GroundingMaterial`, the citation path returns `RetrievedSource`, and nothing here
can construct the latter. §B3.1 requires that "the citation itself always resolves
from Index A"; the way to make that true of every future caller is to leave them
no way to express the alternative.

## What "scoped" means, and why it is a filter rather than a score

§B3: "Retrieval for a given report is restricted to the scopes that report's
deterministic result actually activated. A document scoped to `BRE` can never
surface in a report that only routed to `INS`."

So the scope and locale conditions are a WHERE clause in the repository, applied
before a single vector is read. Ranking happens afterwards, strictly inside that
set. The consequence worth stating plainly: a wrong, stale or adversarial vector
can change the ORDER of correctly-scoped material and can never admit material
from another module, another safety rule, another clinical source or another
locale. A test asserts exactly that, because "the filter comes first" is easy to
write and easy to undo.

## Why rank at all

Because one scope can hold more material than a report should carry, and taking
"whatever the database returned first" is an arbitrary answer dressed as a
deterministic one. Where an embedder is configured, the same approved query terms
the Checkpoint 11.3 similarity path uses — module NAMES, never PII and never
health free-text — rank the scoped set. Where one is not, the order is the
loader's deterministic one and the cap still applies. Both answer identically for
the same corpus and the same request.

The loader indirection mirrors `CitationResolver`: this class holds no session and
knows no SQL, so the object a unit test exercises is the object the service runs.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence

from report.application.retrieval import cosine_similarity
from report.corpus.repository import DocumentScope, ScopedDocument
from report.infrastructure.llm.provider import EmbeddingProvider, EmbeddingRequest
from report.schemas.retrieval import GroundingMaterial, GroundingRequest, RetrievalQuery

logger = logging.getLogger("report.corpus.retrieval")

#: How many documents' worth of material one report can carry. A report is read
#: by a professional in a consultation, not browsed.
DEFAULT_TOP_K = 3

#: Given a locale and the scopes a result activated, the published documents that
#: match both. The filtering is the loader's — and therefore the database's — so
#: this module never widens what it is handed.
ScopedDocumentLoader = Callable[[str, Sequence[DocumentScope]], list[ScopedDocument]]


class CorpusRetriever:
    """Index B, behind the corpus module's public interface (ADR 0010)."""

    def __init__(
        self,
        loader: ScopedDocumentLoader,
        *,
        embedder: EmbeddingProvider | None = None,
        model: str = "",
        dimensions: int = 0,
        top_k: int = DEFAULT_TOP_K,
    ) -> None:
        self._loader = loader
        self._embedder = embedder
        self._model = model
        self._dimensions = dimensions
        self._top_k = top_k

    def retrieve(
        self, request: GroundingRequest, queries: tuple[RetrievalQuery, ...] = ()
    ) -> list[GroundingMaterial]:
        scopes = _scopes_for(request)
        if not scopes:
            # Nothing was activated. `general` material is deliberately not
            # returned on its own: it supports an activated scope, it is not a
            # reason to attach material to a report that activated nothing.
            return []

        documents = self._loader(request.locale, scopes)
        # Everything below has already passed the published / locale / scope
        # filter. Ordering cannot widen it.
        return self._rank(documents, queries)[: self._top_k]

    def _rank(
        self, documents: Sequence[ScopedDocument], queries: tuple[RetrievalQuery, ...]
    ) -> list[GroundingMaterial]:
        query_vectors = self._embed_queries(queries)
        ranked: list[tuple[float, int, str, GroundingMaterial]] = []

        for position, document in enumerate(documents):
            best_text, best_score = _best_chunk(document, query_vectors)
            scope = document.matched_scopes[0] if document.matched_scopes else DocumentScope("", "")
            ranked.append(
                (
                    best_score,
                    # Ties break on the loader's deterministic order, so an
                    # unembedded corpus still answers the same way every render.
                    position,
                    document.id,
                    GroundingMaterial(
                        document_id=document.id,
                        title=document.title,
                        citation=document.citation,
                        locale=document.locale,
                        corpus_version_added=document.corpus_version_added,
                        matched_scope_type=scope.scope_type,
                        matched_scope_key=scope.scope_key,
                        text=best_text,
                        score=best_score,
                    ),
                )
            )

        ranked.sort(key=lambda row: (-row[0], row[1], row[2]))
        return [material for _, _, _, material in ranked]

    def _embed_queries(self, queries: tuple[RetrievalQuery, ...]) -> list[list[float]]:
        """Embed the approved query terms, or return nothing and fall back to order.

        A failure here is not a failure of the render. §B3.1 makes Index B's whole
        contribution optional, so an embedder that is absent, misconfigured or
        down costs ordering quality and nothing else.
        """
        if self._embedder is None or not queries:
            return []
        try:
            return list(
                self._embedder.embed(
                    EmbeddingRequest(
                        # Module names. The same approved vocabulary Checkpoint
                        # 11.3 embeds, so 16.4 introduces no new category of input
                        # to the provider.
                        inputs=[query.text for query in queries],
                        model=self._model,
                        dimensions=self._dimensions,
                    )
                ).vectors
            )
        except Exception:
            logger.warning("corpus query embedding failed; ranking by corpus order instead")
            return []


def _scopes_for(request: GroundingRequest) -> list[DocumentScope]:
    """The scopes a deterministic result activated, and only those (§B3)."""
    return [
        *(DocumentScope("module", module_id) for module_id in request.module_ids),
        *(DocumentScope("safety_rule", rule_id) for rule_id in request.rule_ids),
        # §B3.1: enrichment for the SRC the fired rule cited. The source ids come
        # from Index A's answer, so Index B follows the citation rather than
        # having any part in deciding it.
        *(DocumentScope("clinical_source", source_id) for source_id in request.source_ids),
    ]


def _best_chunk(document: ScopedDocument, query_vectors: list[list[float]]) -> tuple[str, float]:
    """The chunk that best answers the queries, and its score.

    With no query vectors, or a document with none, the first chunk at score 0.0 —
    a stable answer rather than an arbitrary one.
    """
    if not document.chunks:
        return "", 0.0
    if not query_vectors:
        return document.chunks[0].text, 0.0

    best_text = document.chunks[0].text
    best_score = 0.0
    for chunk in document.chunks:
        if not chunk.vector:
            continue
        for query_vector in query_vectors:
            score = cosine_similarity(query_vector, chunk.vector)
            if score > best_score:
                best_score = score
                best_text = chunk.text
    return best_text, best_score
