"""The reference corpus tables (Addendum B §B3), in `somnus_content`.

Four tables, and the shape of them carries two rules from §B3 that the code must
not be free to break.

**Append and retire, never delete.** Retiring a document stops it being retrieved
and keeps the row, stamped with the `corpus_version` that retired it. A report
stamped with an older `corpus_version` therefore stays explainable: the documents
that were live at that version can still be listed, retired ones included.

**Every document is scoped.** `reference_document_scopes` says which modules,
safety rules or clinical sources a document is relevant to, so retrieval in
Checkpoint 16.4 can be restricted to the scopes a report's deterministic result
actually activated. A document scoped to `BRE` can never surface in a report that
only routed to `INS`.

Chunks carry `embedding` as JSON text, exactly as `clinical_sources` does, so the
store runs on MySQL and TiDB alike; a TiDB-native VECTOR column can replace it
without touching the rest. Nothing writes an embedding in this checkpoint —
16.2 adds the rights gate and chunking, 16.4 the embedding.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column

from report.corpus.db import CorpusBase


class CorpusVersionRow(CorpusBase):
    """One entry per publish or retire (§B5 Checkpoint 16.1).

    The version is a monotonic integer rather than a semantic string: it exists to
    be ordered — "which documents were live at version N" is a comparison — and a
    string like "1.10" does not order correctly against "1.9" without parsing.
    """

    __tablename__ = "corpus_versions"

    version: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    # The opaque admin id that caused the bump. Never a name or an address.
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    changelog: Mapped[str] = mapped_column(Text, nullable=False)


class ReferenceDocumentRow(CorpusBase):
    __tablename__ = "reference_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    citation: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(String(64), nullable=False)
    locale: Mapped[str] = mapped_column(String(5), nullable=False)
    # draft | published | retired.
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    # §B4's blocking gate arrives in Checkpoint 16.2; nullable until then, because
    # a draft legitimately has no rights declaration yet. What 16.2 adds is the
    # refusal to PUBLISH without one, not a column.
    rights_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    rights_evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    added_by: Mapped[str] = mapped_column(String(36), nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    reviewed_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    retired_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Set when the document is published, not when the row is created: a draft is
    # not part of any corpus version.
    corpus_version_added: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("corpus_versions.version"), nullable=True
    )
    corpus_version_retired: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("corpus_versions.version"), nullable=True
    )


class ReferenceDocumentChunkRow(CorpusBase):
    __tablename__ = "reference_document_chunks"
    __table_args__ = (UniqueConstraint("document_id", "chunk_index", name="uq_chunk_position"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("reference_documents.id"), nullable=False
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # JSON array of floats, like `clinical_sources.embedding`. Null until 16.4.
    embedding: Mapped[str | None] = mapped_column(LONGTEXT, nullable=True)
    embedded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    embedding_dimensions: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ReferenceDocumentScopeRow(CorpusBase):
    __tablename__ = "reference_document_scopes"

    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("reference_documents.id"), primary_key=True
    )
    # module | safety_rule | clinical_source | general.
    scope_type: Mapped[str] = mapped_column(String(16), primary_key=True)
    # INS, SAFE-006, SRC-05 — or the empty string for `general`, which has no key.
    scope_key: Mapped[str] = mapped_column(String(64), primary_key=True)
