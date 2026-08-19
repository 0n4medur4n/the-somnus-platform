"""ORM models for `somnus_reporting` (build plan §8 / Checkpoint 11.3 / §3.6b).

The report service owns the clinical-source corpus it embeds for explanation-only
grounding. The rows mirror Morpheo's approved SRC-01…SRC-15 (fetched over HTTP,
never from Morpheo's database) plus the embedding produced by the provider
abstraction. The embedding is stored portably as a JSON array of floats
(`LONGTEXT`): the VectorStore does cosine similarity over it on MySQL/TiDB alike;
a TiDB-native `VECTOR` column can accelerate this later without a schema rewrite.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column

from report.infrastructure.db import Base


class ClinicalSourceRow(Base):
    __tablename__ = "clinical_sources"

    # Keyed by (content_version, source_id): re-indexing a new content version
    # never collides with the previous one, so retrieval is always version-scoped.
    content_version: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    citation: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    use_text: Mapped[str] = mapped_column("use_text", Text, nullable=False)
    # Populated by the indexer (Checkpoint 11.3 Stage 3); JSON array of floats.
    embedding: Mapped[str | None] = mapped_column(LONGTEXT, nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
