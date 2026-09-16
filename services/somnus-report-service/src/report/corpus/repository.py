"""The corpus module's public interface (ADR 0010 / Addendum B §B3, §B5 16.1).

Everything outside this module goes through `CorpusRepository`; the tables and
the engine are module-private. It returns plain dataclasses rather than ORM rows,
so a caller cannot lazily wander into a relationship it was not given.

Two properties this class is responsible for, both from §B3:

* **A version is created and bumped on every publish and every retire**, with a
  changelog entry. Nothing else bumps it — adding a draft does not, because a
  draft is not part of any corpus.
* **Nothing is ever deleted.** There is no delete method. Retiring stamps
  `corpus_version_retired` and keeps the row, which is what lets
  `documents_live_at` answer for an older version at all.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from report.corpus.models import (
    CorpusVersionRow,
    ReferenceDocumentChunkRow,
    ReferenceDocumentRow,
    ReferenceDocumentScopeRow,
)

STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"
STATUS_RETIRED = "retired"

SCOPE_MODULE = "module"
SCOPE_SAFETY_RULE = "safety_rule"
SCOPE_CLINICAL_SOURCE = "clinical_source"
SCOPE_GENERAL = "general"
SCOPE_TYPES = frozenset({SCOPE_MODULE, SCOPE_SAFETY_RULE, SCOPE_CLINICAL_SOURCE, SCOPE_GENERAL})


class CorpusStateError(RuntimeError):
    """A transition the corpus does not allow (§B3: append and retire, never delete)."""


@dataclass(frozen=True)
class DocumentScope:
    scope_type: str
    scope_key: str


@dataclass(frozen=True)
class ReferenceDocument:
    id: str
    title: str
    citation: str
    source_type: str
    locale: str
    status: str
    rights_status: str | None
    rights_evidence: str | None
    added_by: str
    corpus_version_added: int | None
    corpus_version_retired: int | None
    retired_reason: str | None
    scopes: tuple[DocumentScope, ...]


@dataclass(frozen=True)
class CorpusVersion:
    version: int
    created_by: str
    changelog: str


def _document(
    row: ReferenceDocumentRow, scopes: Sequence[ReferenceDocumentScopeRow]
) -> ReferenceDocument:
    return ReferenceDocument(
        id=row.id,
        title=row.title,
        citation=row.citation,
        source_type=row.source_type,
        locale=row.locale,
        status=row.status,
        rights_status=row.rights_status,
        rights_evidence=row.rights_evidence,
        added_by=row.added_by,
        corpus_version_added=row.corpus_version_added,
        corpus_version_retired=row.corpus_version_retired,
        retired_reason=row.retired_reason,
        scopes=tuple(
            DocumentScope(scope.scope_type, scope.scope_key)
            for scope in sorted(scopes, key=lambda s: (s.scope_type, s.scope_key))
        ),
    )


class CorpusRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    # --- documents ---------------------------------------------------------

    def add_draft(
        self,
        *,
        title: str,
        citation: str,
        source_type: str,
        locale: str,
        added_by: str,
        scopes: Sequence[DocumentScope],
        rights_status: str | None = None,
        rights_evidence: str | None = None,
    ) -> str:
        """Create a draft. No corpus version: a draft is not part of any corpus."""
        for scope in scopes:
            if scope.scope_type not in SCOPE_TYPES:
                raise CorpusStateError(f"unknown scope type {scope.scope_type!r}")
        document_id = str(uuid.uuid4())
        self._session.add(
            ReferenceDocumentRow(
                id=document_id,
                title=title,
                citation=citation,
                source_type=source_type,
                locale=locale,
                status=STATUS_DRAFT,
                rights_status=rights_status,
                rights_evidence=rights_evidence,
                added_by=added_by,
            )
        )
        # Flushed before the scope rows: a bare ForeignKey does not order a child
        # insert after its parent within one flush.
        self._session.flush()
        for scope in scopes:
            self._session.add(
                ReferenceDocumentScopeRow(
                    document_id=document_id,
                    scope_type=scope.scope_type,
                    scope_key=scope.scope_key,
                )
            )
        self._session.flush()
        return document_id

    def add_chunks(self, document_id: str, texts: Sequence[str]) -> list[str]:
        """Store a document's text, unembedded. Chunking policy is 16.2's; this
        only persists what it is given, positionally."""
        row = self._row(document_id)
        if row.status != STATUS_DRAFT:
            raise CorpusStateError(
                f"document {document_id} is {row.status}; chunks are only added to a draft"
            )
        ids: list[str] = []
        for index, text in enumerate(texts):
            chunk_id = str(uuid.uuid4())
            ids.append(chunk_id)
            self._session.add(
                ReferenceDocumentChunkRow(
                    id=chunk_id, document_id=document_id, chunk_index=index, text=text
                )
            )
        self._session.flush()
        return ids

    def publish(self, document_id: str, *, by: str, changelog: str) -> int:
        """Publish a draft, bumping the corpus version (§B5 Checkpoint 16.1)."""
        row = self._row(document_id)
        if row.status != STATUS_DRAFT:
            raise CorpusStateError(f"document {document_id} is {row.status}, not a draft")
        version = self._next_version(by=by, changelog=changelog)
        row.status = STATUS_PUBLISHED
        row.corpus_version_added = version
        row.reviewed_by = by
        row.reviewed_at = datetime.now(UTC).replace(tzinfo=None)
        self._session.flush()
        return version

    def retire(self, document_id: str, *, by: str, reason: str, changelog: str) -> int:
        """Retire a published document. The row stays; only its status changes."""
        row = self._row(document_id)
        if row.status != STATUS_PUBLISHED:
            raise CorpusStateError(f"document {document_id} is {row.status}, not published")
        version = self._next_version(by=by, changelog=changelog)
        row.status = STATUS_RETIRED
        row.corpus_version_retired = version
        row.retired_at = datetime.now(UTC).replace(tzinfo=None)
        row.retired_reason = reason
        self._session.flush()
        return version

    # --- reads -------------------------------------------------------------

    def get(self, document_id: str) -> ReferenceDocument:
        return _document(self._row(document_id), self._scopes(document_id))

    def documents_live_at(
        self, version: int, *, locale: str | None = None
    ) -> list[ReferenceDocument]:
        """Which documents were live at `version` (§B5 Checkpoint 16.1 exit).

        Live means published at or before that version and not yet retired as of
        it. A document retired LATER was live then, so it is included; that is the
        whole reason retiring keeps the row. Drafts are never live: they have no
        `corpus_version_added`.
        """
        statement = (
            select(ReferenceDocumentRow)
            .where(
                ReferenceDocumentRow.corpus_version_added.is_not(None),
                ReferenceDocumentRow.corpus_version_added <= version,
                (ReferenceDocumentRow.corpus_version_retired.is_(None))
                | (ReferenceDocumentRow.corpus_version_retired > version),
            )
            .order_by(ReferenceDocumentRow.corpus_version_added, ReferenceDocumentRow.id)
        )
        if locale is not None:
            statement = statement.where(ReferenceDocumentRow.locale == locale)
        rows = list(self._session.scalars(statement))
        return [_document(row, self._scopes(row.id)) for row in rows]

    def chunk_texts(self, document_id: str) -> list[str]:
        return list(
            self._session.scalars(
                select(ReferenceDocumentChunkRow.text)
                .where(ReferenceDocumentChunkRow.document_id == document_id)
                .order_by(ReferenceDocumentChunkRow.chunk_index)
            )
        )

    def versions(self) -> list[CorpusVersion]:
        return [
            CorpusVersion(version=row.version, created_by=row.created_by, changelog=row.changelog)
            for row in self._session.scalars(
                select(CorpusVersionRow).order_by(CorpusVersionRow.version)
            )
        ]

    def current_version(self) -> int:
        """The highest version, or 0 when nothing has been published yet."""
        return self._session.scalar(select(func.max(CorpusVersionRow.version))) or 0

    # --- internals ---------------------------------------------------------

    def _next_version(self, *, by: str, changelog: str) -> int:
        if not changelog.strip():
            # §B3 asks for a changelog on every version. An empty one would make
            # the history a list of numbers nobody can read.
            raise CorpusStateError("a corpus version needs a changelog")
        version = self.current_version() + 1
        self._session.add(
            CorpusVersionRow(version=version, created_by=by, changelog=changelog.strip())
        )
        self._session.flush()
        return version

    def _row(self, document_id: str) -> ReferenceDocumentRow:
        row = self._session.get(ReferenceDocumentRow, document_id)
        if row is None:
            raise CorpusStateError(f"no reference document {document_id}")
        return row

    def _scopes(self, document_id: str) -> list[ReferenceDocumentScopeRow]:
        return list(
            self._session.scalars(
                select(ReferenceDocumentScopeRow).where(
                    ReferenceDocumentScopeRow.document_id == document_id
                )
            )
        )
