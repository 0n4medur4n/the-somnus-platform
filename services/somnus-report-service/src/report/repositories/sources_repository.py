"""Persistence for the clinical-source corpus (build plan §8 / §3.6b).

Owns `clinical_sources` in `somnus_reporting`. The indexer replaces a whole
content version atomically (the corpus is small and immutable between content
versions); retrieval reads it back, version-scoped. Writes here never carry any
decision — this is grounding data, outside the clinical decision path (§14b).
"""

from __future__ import annotations

import json

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from report.infrastructure.models import ClinicalSourceRow
from report.schemas.sources import ClinicalSourceDTO, EmbeddedSourceDTO


class SourcesRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def replace_version(self, content_version: str, sources: list[ClinicalSourceDTO]) -> None:
        """Replace every row for a content version (without embeddings yet)."""
        self._session.execute(
            delete(ClinicalSourceRow).where(ClinicalSourceRow.content_version == content_version)
        )
        self._session.add_all(
            ClinicalSourceRow(
                content_version=content_version,
                source_id=source.id,
                citation=source.citation,
                url=source.url,
                use_text=source.use,
            )
            for source in sources
        )
        self._session.flush()

    def replace_embedded(
        self, content_version: str, embedded: list[EmbeddedSourceDTO], model: str
    ) -> None:
        """Replace a content version with rows that carry their embeddings."""
        self._session.execute(
            delete(ClinicalSourceRow).where(ClinicalSourceRow.content_version == content_version)
        )
        self._session.add_all(
            ClinicalSourceRow(
                content_version=content_version,
                source_id=entry.source.id,
                citation=entry.source.citation,
                url=entry.source.url,
                use_text=entry.source.use,
                embedding=json.dumps(entry.vector),
                embedding_model=model,
            )
            for entry in embedded
        )
        self._session.flush()

    def list_version(self, content_version: str) -> list[ClinicalSourceRow]:
        return list(
            self._session.scalars(
                select(ClinicalSourceRow)
                .where(ClinicalSourceRow.content_version == content_version)
                .order_by(ClinicalSourceRow.source_id)
            )
        )
