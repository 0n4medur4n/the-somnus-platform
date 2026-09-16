"""Embedding a published document into Index B (Addendum B §B5 Checkpoint 16.4).

Publishing is what triggers indexing, and that ordering is the point: §B4's rights
gate stands between a draft and `published`, so a document that could not be
published can never be embedded. The two are connected here for the first time,
and this module is the only connection.

Three properties, each of which is a rule from the addendum rather than a
preference:

* **The same adapter as Checkpoint 11.3.** `text-embedding-3-large` through the
  configured `EmbeddingProvider`, reached only through `CorpusEmbeddingGate`
  (§B4). There is no direct SDK call here and no second provider path.
* **All of a document's chunks, or none of them.** §B2a.1 makes Index A
  all-or-nothing; the same reasoning applies with more force to Index B, because
  a half-embedded document is retrievable and looks indexed while grounding on a
  fraction of itself. One call, one write, or nothing.
* **Only approved corpus text.** The inputs are the chunks the console stored and
  §B4's chunker capped. No assessment data, no health free-text and no PII can
  reach this module, because the only thing it reads is
  `reference_document_chunks`.

Optional by design. With no embedding key configured — which is every environment
today — no indexer is wired, publishing still publishes, and the document simply
carries no vectors. §B3.1 already says what that means: an empty Index B degrades
the richness of an explanation and nothing else. It can never degrade a citation,
which resolves from Index A on a path this module cannot reach.
"""

from __future__ import annotations

import logging

from report.corpus.embedding_gate import CorpusEmbeddingGate, EmbeddableDocument
from report.corpus.repository import STATUS_PUBLISHED, CorpusRepository, CorpusStateError

logger = logging.getLogger("report.corpus.indexer")


class CorpusIndexer:
    """Embeds a published document's chunks and stores the vectors."""

    def __init__(self, gate: CorpusEmbeddingGate, *, model: str, dimensions: int) -> None:
        self._gate = gate
        self._model = model
        self._dimensions = dimensions

    def index(self, repository: CorpusRepository, document_id: str) -> int:
        """Embed this document's chunks. Returns how many vectors were stored.

        Refuses anything but a published document. Embedding a draft would put
        text into a third party's hands that no one had yet decided to publish,
        and §B4's gate is a publish-time gate precisely so that decision comes
        first.

        Raises rather than swallowing: the caller publishes and indexes in one
        transaction, so a failure here rolls the publish back and leaves a draft,
        not a published document that is silently absent from retrieval.
        """
        document = repository.get(document_id)
        if document.status != STATUS_PUBLISHED:
            raise CorpusStateError(
                f"document {document_id} is {document.status}; only a published document "
                "is indexed (§B4: the rights gate is what publishing passes)"
            )

        texts = repository.chunk_texts(document_id)
        if not texts:
            return 0

        # The gate re-checks §B4's rights and the per-status cap on the way to the
        # provider. It is not a second opinion about publishing — it is the same
        # `require_publishable`, applied where the call with the legal consequence
        # actually happens.
        response = self._gate.embed(
            EmbeddableDocument(
                id=document.id,
                rights_status=document.rights_status,
                rights_evidence=document.rights_evidence,
            ),
            texts,
            model=self._model,
            dimensions=self._dimensions,
        )

        # A provider that answered with a different model than the one asked for
        # would leave vectors that cannot be compared with the rest of the index.
        # Same refusal as the Index A indexer makes (Checkpoint 16.0).
        if response.model != self._model:
            raise CorpusStateError(
                f"embedding provider answered with model {response.model!r}, not "
                f"{self._model!r}; refusing to store vectors that are not comparable"
            )

        repository.store_embeddings(
            document_id, response.vectors, model=self._model, dimensions=self._dimensions
        )
        return len(response.vectors)
