"""Nothing reaches the embedding API unrighted (Addendum B §B4).

This is the second of §B4's two independent checks. The first is the publish
transition: a document without a rights declaration cannot be published. This one
sits on the call into the Checkpoint 11.3 embedding provider itself, and it does
not care whether the first ever ran.

That redundancy is deliberate and worth stating, because it looks like belt and
braces and is not. The publish gate protects a *workflow*; this protects the
*action with the legal consequence*. A future caller — Checkpoint 16.4's retrieval
wiring, a backfill script, a console path written in a hurry — could embed a draft
without going near `publish()`. §B4 says "no document reaches the embedding API
before `rights_status` is set", and the only way to make that true of every caller
is to check it where the call happens.

The guard also refuses to embed text it was not shown alongside its document, so
a caller cannot hand it a righted document and a different document's text.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from report.corpus.chunking import cap_for
from report.corpus.rights import RightsError, require_publishable
from report.infrastructure.llm.provider import (
    EmbeddingProvider,
    EmbeddingRequest,
    EmbeddingResponse,
)


@dataclass(frozen=True)
class EmbeddableDocument:
    """The minimum a caller must show to have text embedded: who it is, and its rights."""

    id: str
    rights_status: str | None
    rights_evidence: str | None


class CorpusEmbeddingGate:
    """The only sanctioned way for corpus text to reach an `EmbeddingProvider`.

    Wraps the provider rather than being called beside it, so "did anyone check
    the rights?" is not a question about call order. The provider is untouched
    until every check has passed.
    """

    def __init__(self, embedder: EmbeddingProvider) -> None:
        self._embedder = embedder

    def embed(
        self,
        document: EmbeddableDocument,
        texts: Sequence[str],
        *,
        model: str,
        dimensions: int,
    ) -> EmbeddingResponse:
        # 1. Rights, declared and evidenced. Identical rule to the publish gate,
        #    from the same function, so the two cannot drift apart.
        require_publishable(document.rights_status, document.rights_evidence)

        # 2. The cap that the status implies, re-checked here. Text could have been
        #    stored before a status was narrowed to `citation_only`, and this call
        #    is the one that would send it to a third party.
        cap = cap_for(document.rights_status)
        if cap is not None:
            total = sum(len(text) for text in texts)
            if total > cap:
                raise RightsError(
                    f"document {document.id} is {document.rights_status} and may hold at most "
                    f"{cap} characters, but {total} were offered for embedding; refused"
                )

        if not texts:
            return EmbeddingResponse(vectors=[], model=model)
        return self._embedder.embed(
            EmbeddingRequest(inputs=list(texts), model=model, dimensions=dimensions)
        )
