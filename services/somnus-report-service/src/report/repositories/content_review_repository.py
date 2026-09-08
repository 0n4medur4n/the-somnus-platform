"""Persistence for the AI content review queue (Checkpoint 15.3, build plan §8).

Owns `ai_content_review_items` in `somnus_reporting`. Nothing outside this
service reads or writes these rows (§7): the admin console reaches them through
edge-api, which calls this service over HTTP.

Two behaviours are deliberate rather than incidental:

* `record_decision` updates only rows still `pending_review`, in the WHERE clause
  rather than after a read. Two reviewers deciding the same item concurrently
  cannot both win: the second update matches nothing and the caller is told the
  item was already decided. That is what makes reviewer identity and timestamp on
  an approved item immutable in practice, not just by convention.
* `latest_approved_for_report` filters on the stored status. There is no method
  that returns a candidate without regard to status, so a rejected or pending
  item has no route out of this repository at all.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any, cast

from sqlalchemy import CursorResult, select, update
from sqlalchemy.orm import Session

from report.application.content_review import (
    STATUS_APPROVED,
    STATUS_PENDING,
    ContentReviewItem,
)
from report.infrastructure.models import AiContentReviewItemRow


def _to_item(row: AiContentReviewItemRow) -> ContentReviewItem:
    return ContentReviewItem(
        item_id=row.item_id,
        report_id=row.report_id,
        prompt_template_version=row.prompt_template_version,
        model_id=row.model_id,
        input_hash=row.input_hash,
        output_hash=row.output_hash,
        deterministic_text=row.deterministic_text,
        candidate_text=row.candidate_text,
        status=row.status,
        reviewer_id=row.reviewer_id,
        decided_at=row.decided_at,
        reason=row.reason,
        created_at=row.created_at,
    )


class ContentReviewRepositorySql:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, item: ContentReviewItem) -> None:
        self._session.add(
            AiContentReviewItemRow(
                item_id=item.item_id,
                report_id=item.report_id,
                prompt_template_version=item.prompt_template_version,
                model_id=item.model_id,
                input_hash=item.input_hash,
                output_hash=item.output_hash,
                deterministic_text=item.deterministic_text,
                candidate_text=item.candidate_text,
                status=item.status,
                reviewer_id=item.reviewer_id,
                decided_at=item.decided_at,
                reason=item.reason,
            )
        )
        self._session.flush()

    def get(self, item_id: str) -> ContentReviewItem | None:
        row = self._session.get(AiContentReviewItemRow, item_id)
        return None if row is None else _to_item(row)

    def list_by_status(self, status: str, *, limit: int) -> Sequence[ContentReviewItem]:
        rows = self._session.scalars(
            select(AiContentReviewItemRow)
            .where(AiContentReviewItemRow.status == status)
            .order_by(AiContentReviewItemRow.created_at.asc())
            .limit(limit)
        ).all()
        return [_to_item(row) for row in rows]

    def latest_approved_for_report(self, report_id: str) -> ContentReviewItem | None:
        row = self._session.scalars(
            select(AiContentReviewItemRow)
            .where(
                AiContentReviewItemRow.report_id == report_id,
                AiContentReviewItemRow.status == STATUS_APPROVED,
            )
            .order_by(AiContentReviewItemRow.decided_at.desc())
            .limit(1)
        ).first()
        return None if row is None else _to_item(row)

    def record_decision(
        self, item_id: str, *, status: str, reviewer_id: str, reason: str, decided_at: datetime
    ) -> ContentReviewItem | None:
        """Decide a still-pending item. Returns None if it was already decided."""
        statement = (
            update(AiContentReviewItemRow)
            .where(
                AiContentReviewItemRow.item_id == item_id,
                # The guard that makes a decision final. A row that has already
                # moved off `pending_review` matches nothing here.
                AiContentReviewItemRow.status == STATUS_PENDING,
            )
            .values(
                status=status,
                reviewer_id=reviewer_id,
                reason=reason,
                decided_at=decided_at,
            )
        )
        # Session.execute is typed as Result; a DML statement returns a
        # CursorResult, which is where rowcount lives.
        result = cast("CursorResult[Any]", self._session.execute(statement))
        self._session.flush()
        if result.rowcount == 0:
            return None
        return self.get(item_id)
