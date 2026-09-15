"""Indexes the approved clinical-source corpus for grounding (build plan §3.6b).

A batch operation (deploy step, never at request time and never on boot): fetch
the approved SRC corpus from Morpheo, embed ONLY its approved text — the citation
and the clinical-use description — and persist the vectors in `somnus_reporting`.

No PII and no health free-text is ever embedded: the indexer works over the static
approved corpus, decoupled from any assessment, and never sees patient data. This
is outside the clinical decision path (§14b); retrieval attaches these sources to
decisions the deterministic engine already made, never makes them.

## Re-runnable (Addendum B §B2a.1 / Checkpoint 16.0)

Keyed on `(content_version, src_id, text_hash)`, where `text_hash` is the SHA-256
of exactly the text sent to the embedding API. For each source the indexer takes
the cheapest correct path, in this order:

1. **Already indexed** — this version holds a vector for this source, from this
   text, with this model. Nothing to do: no call, no write.
2. **Reusable** — another version holds a vector for the same source, from the
   same text, with the same model and dimensions. Copied, no call. This is what
   makes a `content_version` bump that changed one source cost one embedding.
3. **Needs embedding** — everything else, in a single call.

Three things it never does, each of which is the failure §B2a.1 exists to prevent:

* **It never overwrites a stored vector.** A version's rows are written once.
  Older versions are not touched at all, so a report grounded under an earlier
  `content_version` can still resolve exactly what grounded it.
* **It never persists a partial index.** The count check from Checkpoint 11.3
  Stage 3 is unchanged, and nothing is written until every vector the version
  needs is in hand. A failure anywhere before that leaves the store untouched.
* **It never quietly re-indexes a version whose text changed.** If a version
  already holds a vector for a source and that source's text now hashes
  differently, the artifact was edited without a `content_version` bump. §B1
  promises "content_version 1.3 always means the same rules and the same
  citations"; overwriting would break that silently, so the indexer refuses
  before making any call.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from report.infrastructure.llm.provider import EmbeddingProvider, EmbeddingRequest
from report.infrastructure.sources_client import SourcesProvider
from report.schemas.sources import ClinicalSourceDTO, IndexedEntry, IndexedRow


def embedding_text(source: ClinicalSourceDTO) -> str:
    """The ONLY text ever embedded for a source: its approved corpus fields."""
    return f"{source.citation}\n{source.use}"


def text_hash(source: ClinicalSourceDTO) -> str:
    """SHA-256 of `embedding_text` — the identity of the text a vector came from."""
    return hashlib.sha256(embedding_text(source).encode("utf-8")).hexdigest()


class SourceIndexStore(Protocol):
    def indexed_rows(self, content_version: str) -> list[IndexedRow]: ...

    def reusable_vectors(
        self, keys: Sequence[tuple[str, str]], model: str
    ) -> dict[tuple[str, str], list[float]]: ...

    def write_indexed(
        self, content_version: str, entries: Sequence[IndexedEntry], model: str
    ) -> None: ...


class ContentVersionDriftError(RuntimeError):
    """A version's approved text changed without a `content_version` bump."""


@dataclass(frozen=True)
class IndexResult:
    content_version: str
    # Sources the version holds once this run is done.
    indexed: int
    model: str
    # Sent to the embedding API this run. Zero on an unchanged re-run.
    embedded: int = 0
    # Copied from another version's identical text, without a call.
    reused: int = 0
    # Already in this version, left exactly as it was.
    unchanged: int = 0


class SourceIndexer:
    def __init__(
        self,
        provider: SourcesProvider,
        embedder: EmbeddingProvider,
        repository: SourceIndexStore,
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
        version = corpus.content_version
        hashes = {source.id: text_hash(source) for source in corpus.sources}
        existing = {row.source_id: row for row in self._repository.indexed_rows(version)}

        self._refuse_drift(version, corpus.sources, hashes, existing)

        # After `_refuse_drift`, a stored vector in this version is known to match
        # the current text and model, so it is simply left alone.
        unchanged_ids = {row.source_id for row in existing.values() if row.has_vector}
        unchanged = [source for source in corpus.sources if source.id in unchanged_ids]
        pending = [source for source in corpus.sources if source.id not in unchanged_ids]
        if not pending:
            return IndexResult(
                content_version=version,
                indexed=len(corpus.sources),
                model=self._model,
                unchanged=len(unchanged),
            )

        found = self._repository.reusable_vectors(
            [(source.id, hashes[source.id]) for source in pending], self._model
        )
        reused = {
            source.id: vector
            for source in pending
            if (vector := found.get((source.id, hashes[source.id]))) is not None
            # A vector of the wrong length came from a different dimensions
            # setting; it is not the same embedding and cannot stand in for one.
            and len(vector) == self._dimensions
        }
        to_embed = [source for source in pending if source.id not in reused]

        embedded: dict[str, list[float]] = {}
        if to_embed:
            response = self._embedder.embed(
                EmbeddingRequest(
                    inputs=[embedding_text(source) for source in to_embed],
                    model=self._model,
                    dimensions=self._dimensions,
                )
            )
            # The Checkpoint 11.3 Stage 3 abort, unchanged: a provider that returns
            # the wrong number of vectors must never persist a misaligned corpus,
            # which would put one source's vector on another source's citation.
            if len(response.vectors) != len(to_embed):
                raise ValueError("embedding count does not match the source count")
            # Rows are stamped with the model that was REQUESTED, because that is
            # the key the next run looks them up by. A provider answering with a
            # different model produced vectors we did not ask for; storing them
            # under the requested name would make them lie, and storing them under
            # the returned name would make every later run read as drift.
            if response.model != self._model:
                raise ValueError(
                    f"embedding provider answered with {response.model}, not {self._model}"
                )
            embedded = {
                source.id: vector for source, vector in zip(to_embed, response.vectors, strict=True)
            }

        # Nothing has been written before this line, whatever happened above.
        self._repository.write_indexed(
            version,
            [
                IndexedEntry(
                    source=source,
                    text_hash=hashes[source.id],
                    vector=reused[source.id] if source.id in reused else embedded[source.id],
                )
                for source in pending
            ],
            self._model,
        )
        return IndexResult(
            content_version=version,
            indexed=len(corpus.sources),
            model=self._model,
            embedded=len(embedded),
            reused=len(reused),
            unchanged=len(unchanged),
        )

    def _refuse_drift(
        self,
        version: str,
        sources: Sequence[ClinicalSourceDTO],
        hashes: dict[str, str],
        existing: dict[str, IndexedRow],
    ) -> None:
        """Refuse, before any call or write, to rewrite what a version already holds."""
        current = {source.id for source in sources}
        for row in existing.values():
            if not row.has_vector:
                continue
            if row.source_id not in current:
                raise ContentVersionDriftError(
                    f"content_version {version} is indexed with {row.source_id}, which the "
                    "artifact no longer contains. Bump content_version instead of editing it."
                )
            if row.text_hash is None:
                raise ContentVersionDriftError(
                    f"content_version {version} holds a vector for {row.source_id} with no "
                    "recorded text hash (indexed before Checkpoint 16.0), so it cannot be "
                    "shown to match the current text. Re-index under a new content_version."
                )
            if row.text_hash != hashes[row.source_id]:
                raise ContentVersionDriftError(
                    f"{row.source_id}'s citation or use changed but content_version is still "
                    f"{version}. Bump content_version; an indexed version is never rewritten."
                )
            if row.embedding_model != self._model:
                raise ContentVersionDriftError(
                    f"content_version {version} was indexed with {row.embedding_model}, not "
                    f"{self._model}. A model change is a new index, not a rewrite of this one."
                )
