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

from sqlalchemy import DateTime, Index, String, Text, func
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
    # JSON array of the safety-rule ids that cite this source (Checkpoint 11.3
    # Stage 4). Persisted with the row rather than looked up per render: it is
    # version-keyed exactly like the citation text it selects, so a report
    # rendered against an older `content_version` resolves that version's mapping
    # and not today's. Nullable for rows written before the column existed.
    cited_by_rules: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Populated by the indexer (Checkpoint 11.3 Stage 3); JSON array of floats.
    embedding: Mapped[str | None] = mapped_column(LONGTEXT, nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class AiContentReviewItemRow(Base):
    """An AI candidate awaiting, or carrying, a human decision (Checkpoint 15.3).

    Build plan §15 requires that AI-generated health text be reviewed before
    release, and logs model id, template version, and input/output hashes per
    generation. Those hashes live here alongside the decision so an approved
    report can be traced back to exactly which generation a named reviewer
    accepted, and when.

    `deterministic_text` is stored, not re-derived: Addendum A §A4 requires the
    reviewer to see the approved prose side by side with the candidate, and a
    hash cannot be shown to a human. Both columns hold health-related prose, which
    is the point of a review queue -- §15's "never log unnecessary raw health
    information" governs the LOG, and the log carries only hashes.
    """

    __tablename__ = "ai_content_review_items"

    item_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    report_id: Mapped[str] = mapped_column(String(32), nullable=False)
    prompt_template_version: Mapped[str] = mapped_column(String(32), nullable=False)
    model_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # sha256 hex of the structured input and of the model's response (§15).
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    output_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    deterministic_text: Mapped[str] = mapped_column(Text, nullable=False)
    candidate_text: Mapped[str] = mapped_column(Text, nullable=False)
    # pending_review | approved | rejected. Only `approved` is ever renderable.
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    # Null until decided; set together and never rewritten (decisions are final).
    reviewer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # The queue reads by status, and the render gate reads the approved item
        # for one report; both are the hot paths.
        Index("ix_ai_content_review_status_created", "status", "created_at"),
        Index("ix_ai_content_review_report_status", "report_id", "status"),
    )
