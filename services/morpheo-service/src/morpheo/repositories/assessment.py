"""Persistence for the anonymous assessment flow (build plan §14 / §10.2)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, cast

from sqlalchemy import CursorResult, delete, select, update
from sqlalchemy.orm import Session

from morpheo.infrastructure.models import (
    AssessmentAnswer,
    AssessmentClaimToken,
    AssessmentSession,
    AssessmentSnapshot,
    MorpheoAuditEvent,
)


class AssessmentRepository:
    def __init__(self, session: Session) -> None:
        self._s = session

    # --- sessions & answers ---

    def create_session(self, row: AssessmentSession) -> AssessmentSession:
        self._s.add(row)
        self._s.commit()
        return row

    def get_session(self, session_id: str) -> AssessmentSession | None:
        return self._s.get(AssessmentSession, session_id)

    def set_status(self, session_id: str, status: str) -> None:
        session = self._s.get(AssessmentSession, session_id)
        if session is not None:
            session.status = status
            self._s.commit()

    def add_answer(self, session_id: str, kind: str, name: str, value: str | None) -> None:
        self._s.add(AssessmentAnswer(session_id=session_id, kind=kind, name=name, value=value))
        self._s.commit()

    def answers(self, session_id: str) -> list[AssessmentAnswer]:
        stmt = select(AssessmentAnswer).where(AssessmentAnswer.session_id == session_id)
        return list(self._s.scalars(stmt))

    # --- claim tokens (single-use, atomic) ---

    def create_token(self, token: str, session_id: str, expires_at: datetime) -> None:
        self._s.add(AssessmentClaimToken(token=token, session_id=session_id, expires_at=expires_at))
        self._s.commit()

    def get_token(self, token: str) -> AssessmentClaimToken | None:
        return self._s.get(AssessmentClaimToken, token)

    def claim_token_atomic(self, token: str, claimed_by: str, now: datetime) -> str | None:
        """Claim exactly once: the conditional UPDATE succeeds for a single caller.

        Concurrent claims race on `claimed_at IS NULL`; MySQL row-locks the row, so
        exactly one UPDATE affects a row (rowcount == 1) and the rest see 0.
        """
        stmt = (
            update(AssessmentClaimToken)
            .where(
                AssessmentClaimToken.token == token,
                AssessmentClaimToken.claimed_at.is_(None),
                AssessmentClaimToken.expires_at > now,
            )
            .values(claimed_at=now, claimed_by=claimed_by)
        )
        result = cast("CursorResult[Any]", self._s.execute(stmt))
        self._s.commit()
        if result.rowcount != 1:
            return None
        claimed = self._s.get(AssessmentClaimToken, token)
        return claimed.session_id if claimed is not None else None

    # --- immutable snapshots ---

    def create_snapshot(self, row: AssessmentSnapshot) -> AssessmentSnapshot:
        self._s.add(row)
        self._s.commit()
        return row

    def get_snapshot(self, session_id: str) -> AssessmentSnapshot | None:
        stmt = select(AssessmentSnapshot).where(AssessmentSnapshot.session_id == session_id)
        return self._s.scalars(stmt).first()

    # --- audit + worker TTL ---

    def add_audit(self, session_id: str | None, event_type: str, payload_json: str) -> None:
        self._s.add(
            MorpheoAuditEvent(
                session_id=session_id, event_type=event_type, payload_json=payload_json
            )
        )
        self._s.commit()

    def unclaimed_older_than(self, cutoff: datetime) -> list[str]:
        """Open sessions created before the cutoff (worker cleanup, §14: 30-day TTL)."""
        stmt = select(AssessmentSession.id).where(
            AssessmentSession.status == "open",
            AssessmentSession.created_at < cutoff,
        )
        return list(self._s.scalars(stmt))

    def delete_unclaimed_before(self, cutoff: datetime) -> int:
        """Purge open sessions created before the cutoff, with their answers and
        claim tokens (build plan §12.2: 30-day unclaimed-assessment cleanup). No
        FK cascade in this schema (TiDB), so dependents are deleted explicitly."""
        ids = self.unclaimed_older_than(cutoff)
        if not ids:
            return 0
        opts = {"synchronize_session": False}
        self._s.execute(
            delete(AssessmentClaimToken).where(AssessmentClaimToken.session_id.in_(ids)),
            execution_options=opts,
        )
        self._s.execute(
            delete(AssessmentAnswer).where(AssessmentAnswer.session_id.in_(ids)),
            execution_options=opts,
        )
        self._s.execute(
            delete(AssessmentSession).where(AssessmentSession.id.in_(ids)),
            execution_options=opts,
        )
        self._s.commit()
        return len(ids)

    def delete_by_claimed_by(self, user_id: str) -> int:
        """Erase every assessment a user claimed — its snapshot, session, answers,
        and claim token (build plan §21 / 13.2, account deletion). Morpheo owns and
        deletes its own data; the caller (edge) orchestrates the account erasure."""
        ids = list(
            self._s.scalars(
                select(AssessmentSnapshot.session_id).where(
                    AssessmentSnapshot.claimed_by == user_id
                )
            )
        )
        if not ids:
            return 0
        opts = {"synchronize_session": False}
        self._s.execute(
            delete(AssessmentClaimToken).where(AssessmentClaimToken.session_id.in_(ids)),
            execution_options=opts,
        )
        self._s.execute(
            delete(AssessmentAnswer).where(AssessmentAnswer.session_id.in_(ids)),
            execution_options=opts,
        )
        self._s.execute(
            delete(AssessmentSnapshot).where(AssessmentSnapshot.session_id.in_(ids)),
            execution_options=opts,
        )
        self._s.execute(
            delete(AssessmentSession).where(AssessmentSession.id.in_(ids)),
            execution_options=opts,
        )
        self._s.commit()
        return len(ids)

    def delete_claim_tokens_before(self, cutoff: datetime) -> int:
        """Purge claim tokens created before the cutoff (build plan §12.2: 72 h
        claim-token cleanup). Single-use tokens; deleting an old one is always safe."""
        result = cast(
            "CursorResult[Any]",
            self._s.execute(
                delete(AssessmentClaimToken).where(AssessmentClaimToken.created_at < cutoff),
                execution_options={"synchronize_session": False},
            ),
        )
        self._s.commit()
        return result.rowcount
