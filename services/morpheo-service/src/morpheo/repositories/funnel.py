"""Persistence for the v2 interview (`funnel_sessions`, `funnel_answers`).

Answers are kept in the order given (the engine reads them in that order: the
cross-cutting exception follows it). Going back removes the last answer;
correcting one (Z1) removes it and everything after it, since later questions
may no longer apply. No FK cascade (TiDB): dependents are deleted explicitly.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import CursorResult, delete, select
from sqlalchemy.orm import Session

from morpheo.infrastructure.models import FunnelAnswer, FunnelSession

_SYNC = {"synchronize_session": False}


class FunnelRepository:
    def __init__(self, session: Session) -> None:
        self._s = session

    def create(self, owner_id: str | None, content_version: str, rules_version: str) -> str:
        session_id = str(uuid.uuid4())
        self._s.add(
            FunnelSession(
                id=session_id,
                owner_id=owner_id,
                consent_given=True,
                status="open",
                content_version=content_version,
                rules_version=rules_version,
            )
        )
        # Committed on its own, before any answer refers to it.
        self._s.commit()
        return session_id

    def get(self, session_id: str) -> FunnelSession | None:
        return self._s.get(FunnelSession, session_id)

    def answers(self, session_id: str) -> list[FunnelAnswer]:
        stmt = (
            select(FunnelAnswer)
            .where(FunnelAnswer.session_id == session_id)
            .order_by(FunnelAnswer.id)
        )
        return list(self._s.scalars(stmt))

    def add_answer(
        self,
        session_id: str,
        step_key: str,
        value_json: str | None,
        absence: str | None,
        text: str | None,
    ) -> None:
        self._s.add(
            FunnelAnswer(
                session_id=session_id,
                step_key=step_key,
                value_json=value_json,
                absence=absence,
                text=text,
            )
        )
        self._s.commit()

    def delete_from(self, session_id: str, first_answer_id: int) -> None:
        """Remove an answer and every answer given after it."""
        self._s.execute(
            delete(FunnelAnswer).where(
                FunnelAnswer.session_id == session_id, FunnelAnswer.id >= first_answer_id
            ),
            execution_options=_SYNC,
        )
        self._s.commit()

    def set_status(self, session_id: str, status: str) -> None:
        session = self._s.get(FunnelSession, session_id)
        if session is None:
            return
        session.status = status
        session.finished_at = None if status == "open" else datetime.now(UTC).replace(tzinfo=None)
        self._s.commit()

    def owned_by(self, owner_id: str) -> list[FunnelSession]:
        stmt = (
            select(FunnelSession)
            .where(FunnelSession.owner_id == owner_id)
            .order_by(FunnelSession.created_at.desc())
        )
        return list(self._s.scalars(stmt))

    # --- retention ---

    def _delete_sessions(self, ids: list[str]) -> int:
        if not ids:
            return 0
        self._s.execute(
            delete(FunnelAnswer).where(FunnelAnswer.session_id.in_(ids)), execution_options=_SYNC
        )
        result = cast(
            "CursorResult[Any]",
            self._s.execute(
                delete(FunnelSession).where(FunnelSession.id.in_(ids)), execution_options=_SYNC
            ),
        )
        self._s.commit()
        return result.rowcount

    def delete_anonymous_before(self, cutoff: datetime) -> int:
        """Anonymous interviews past the 30-day TTL, with their answers."""
        ids = list(
            self._s.scalars(
                select(FunnelSession.id).where(
                    FunnelSession.owner_id.is_(None), FunnelSession.created_at < cutoff
                )
            )
        )
        return self._delete_sessions(ids)

    def delete_owned_by(self, owner_id: str) -> int:
        """Every interview of a person, with their answers (account deletion)."""
        ids = list(
            self._s.scalars(select(FunnelSession.id).where(FunnelSession.owner_id == owner_id))
        )
        return self._delete_sessions(ids)
