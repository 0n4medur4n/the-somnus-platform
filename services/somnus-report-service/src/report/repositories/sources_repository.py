"""Persistence for the clinical-source corpus (build plan §8 / §3.6b).

Owns `clinical_sources` in `somnus_reporting`. Retrieval reads it back,
version-scoped. Writes here never carry any decision — this is grounding data,
outside the clinical decision path (§14b).

**Append-only for vectors (Addendum B §B2a.1 / Checkpoint 16.0).** There is no
method here that deletes a row or replaces a stored vector. Until 16.0 the indexer
wrote through `replace_embedded`, which deleted a whole version and re-inserted
it; retention of prior versions happened to hold only because each run used a new
`content_version`. It is now structural: `write_indexed` inserts rows a version
does not have yet and fills a vector into a row that has none, and it refuses
anything else, so no caller — not the indexer, not a future admin path — can
rewrite what an older report was grounded in.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from report.infrastructure.models import ClinicalSourceRow
from report.schemas.sources import IndexedEntry, IndexedRow


class StoredVectorOverwriteError(RuntimeError):
    """A write tried to replace a vector that is already stored."""


class SourcesRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def indexed_rows(self, content_version: str) -> list[IndexedRow]:
        return [
            IndexedRow(
                source_id=row.source_id,
                text_hash=row.text_hash,
                embedding_model=row.embedding_model,
                has_vector=bool(row.embedding),
            )
            for row in self.list_version(content_version)
        ]

    def reusable_vectors(
        self, keys: Sequence[tuple[str, str]], model: str
    ) -> dict[tuple[str, str], list[float]]:
        """Stored vectors for these `(source_id, text_hash)` pairs, from any version.

        Rows with no recorded hash never match: a vector whose source text is
        unknown cannot be shown to be the embedding of the text being indexed.
        Where several versions hold the same text, the oldest row wins, so the
        answer does not depend on the order rows happen to come back in.
        """
        if not keys:
            return {}
        rows = self._session.scalars(
            select(ClinicalSourceRow)
            .where(
                tuple_(ClinicalSourceRow.source_id, ClinicalSourceRow.text_hash).in_(list(keys)),
                ClinicalSourceRow.embedding_model == model,
                ClinicalSourceRow.embedding.is_not(None),
            )
            .order_by(ClinicalSourceRow.created_at, ClinicalSourceRow.content_version)
        )
        found: dict[tuple[str, str], list[float]] = {}
        for row in rows:
            key = (row.source_id, row.text_hash or "")
            if key not in found and row.embedding:
                found[key] = json.loads(row.embedding)
        return found

    def write_indexed(
        self, content_version: str, entries: Sequence[IndexedEntry], model: str
    ) -> None:
        """Add a version's missing rows, or fill vectors into rows that have none.

        Flushes but does not commit: the caller commits once, so a run either
        lands whole or not at all.
        """
        existing = {row.source_id: row for row in self.list_version(content_version)}
        for entry in entries:
            row = existing.get(entry.source.id)
            if row is not None and row.embedding:
                raise StoredVectorOverwriteError(
                    f"{entry.source.id} in content_version {content_version} already has a "
                    "stored vector; stored vectors are never replaced"
                )
            if row is None:
                row = ClinicalSourceRow(content_version=content_version, source_id=entry.source.id)
                self._session.add(row)
            row.citation = entry.source.citation
            row.url = entry.source.url
            row.use_text = entry.source.use
            row.cited_by_rules = json.dumps(list(entry.source.cited_by_rules))
            row.embedding = json.dumps(entry.vector)
            row.embedding_model = model
            row.text_hash = entry.text_hash
        self._session.flush()

    def list_version(self, content_version: str) -> list[ClinicalSourceRow]:
        return list(
            self._session.scalars(
                select(ClinicalSourceRow)
                .where(ClinicalSourceRow.content_version == content_version)
                .order_by(ClinicalSourceRow.source_id)
            )
        )
