"""Persistence for report corpus provenance (Addendum B §B5 Checkpoint 16.5).

Owns `report_corpus_provenance` in `somnus_reporting`. Two methods: write one,
read one. There is deliberately no third.

**Write once.** `record` inserts and refuses a second write for the same report,
and the primary key would refuse it anyway. There is no `update`, no `upsert` and
no partial write that a later step is expected to complete, because a provenance
record that can be revised after the fact answers a different question from the
one it exists to answer — "what grounded this report" becomes "what someone last
said grounded this report". This is the same discipline as the break-glass audit
event (Checkpoint 15.5) and every other stamped-at-generation field (§17).

The refusal is explicit rather than left to the database, so a caller that tries
gets a sentence explaining why rather than an integrity error it might be tempted
to catch and retry.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from report.infrastructure.models import ReportCorpusProvenanceRow
from report.schemas.provenance import CitationRecord, ReportProvenanceRecord


class ProvenanceImmutableError(RuntimeError):
    """A report's provenance was already recorded and may not be rewritten."""


class ProvenanceRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def record(
        self,
        report_id: str,
        *,
        corpus_version: int,
        content_version: str,
        locale: str,
        citations: Sequence[CitationRecord],
        document_ids: Sequence[str],
    ) -> None:
        """Stamp what grounded this report. Once, at generation, and never again."""
        if self._session.get(ReportCorpusProvenanceRow, report_id) is not None:
            raise ProvenanceImmutableError(
                f"report {report_id} already has a corpus provenance record; provenance is "
                "written once at generation and is never rewritten"
            )
        self._session.add(
            ReportCorpusProvenanceRow(
                report_id=report_id,
                corpus_version=corpus_version,
                content_version=content_version,
                locale=locale,
                citations=json.dumps(
                    [
                        {
                            "sourceId": citation.source_id,
                            "citation": citation.citation,
                            "url": citation.url,
                            "resolvedBy": citation.resolved_by,
                        }
                        for citation in citations
                    ],
                    ensure_ascii=False,
                ),
                document_ids=json.dumps(list(document_ids), ensure_ascii=False),
            )
        )
        self._session.flush()

    def get(self, report_id: str) -> ReportProvenanceRecord | None:
        row = self._session.get(ReportCorpusProvenanceRow, report_id)
        return _to_record(row) if row is not None else None

    def get_many(self, report_ids: Sequence[str]) -> dict[str, ReportProvenanceRecord]:
        """One query for a whole queue page, rather than one per item."""
        if not report_ids:
            return {}
        rows = self._session.scalars(
            select(ReportCorpusProvenanceRow).where(
                ReportCorpusProvenanceRow.report_id.in_(list(report_ids))
            )
        )
        return {row.report_id: _to_record(row) for row in rows}


def _to_record(row: ReportCorpusProvenanceRow) -> ReportProvenanceRecord:
    return ReportProvenanceRecord(
        report_id=row.report_id,
        corpus_version=row.corpus_version,
        content_version=row.content_version,
        locale=row.locale,
        citations=tuple(
            CitationRecord(
                source_id=str(entry.get("sourceId", "")),
                citation=str(entry.get("citation", "")),
                url=str(entry.get("url", "")),
                resolved_by=str(entry.get("resolvedBy", "")),
            )
            for entry in _parse_list(row.citations)
            if isinstance(entry, dict)
        ),
        document_ids=tuple(str(value) for value in _parse_list(row.document_ids)),
    )


def _parse_list(raw: str | None) -> list[Any]:
    """Stored JSON, or an empty list. A malformed record reads as empty.

    Never raises: a provenance record is shown beside clinical prose a reviewer is
    judging, and a screen that fails to load because one row is malformed is worse
    than one that shows less than it might.
    """
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []
