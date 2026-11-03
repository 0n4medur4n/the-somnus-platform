"""Persistence for the case record of each v2 interview (ADR 0024).

A case is opened with the interview and outlives it: the interview's 30-day TTL
and account erasure delete the interview and its answers, and only clear the
case's `session_id` -- the one link to a person. What remains is the frozen
record of what was asked, answered and shown, under a random code. Records,
changes and accesses are only ever appended.
"""

from __future__ import annotations

import json
import re
import secrets
from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import CursorResult, delete, select, update
from sqlalchemy.orm import Session

from morpheo.infrastructure.models import (
    FunnelCase,
    FunnelCaseAccess,
    FunnelCaseChange,
    FunnelCaseRecord,
)

_SYNC = {"synchronize_session": False}

# Crockford's base32: no I, L, O or U, so a code read aloud or typed from a
# printout cannot be mistaken for another one.
_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_PREFIX = "SOM"
_GROUP = 4
_CODE = re.compile(rf"^{_PREFIX}-[{_ALPHABET}]{{{_GROUP}}}-[{_ALPHABET}]{{{_GROUP}}}$")
# What people type for the letters Crockford leaves out.
_LOOKALIKES = str.maketrans({"I": "1", "L": "1", "O": "0"})


def new_code() -> str:
    """A random case code, e.g. SOM-7K3F-Q9XA (40 random bits)."""
    groups = ("".join(secrets.choice(_ALPHABET) for _ in range(_GROUP)) for _ in range(2))
    return "-".join((_PREFIX, *groups))


def normalise_code(raw: str) -> str | None:
    """A typed code in canonical form, or None if it cannot be one."""
    compact = re.sub(r"[\s-]", "", raw.upper())
    if len(compact) == len(_PREFIX) + 2 * _GROUP and compact.startswith(_PREFIX):
        compact = compact[len(_PREFIX) :]
    if len(compact) != 2 * _GROUP:
        return None
    compact = compact.translate(_LOOKALIKES)
    code = f"{_PREFIX}-{compact[:_GROUP]}-{compact[_GROUP:]}"
    return code if _CODE.match(code) else None


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class CaseRepository:
    def __init__(self, session: Session) -> None:
        self._s = session

    def create(
        self,
        session_id: str,
        content_version: str,
        rules_version: str,
        started_at: datetime | None = None,
    ) -> str:
        code = new_code()
        while self._s.get(FunnelCase, code) is not None:
            code = new_code()
        self._s.add(
            FunnelCase(
                code=code,
                session_id=session_id,
                status="open",
                content_version=content_version,
                rules_version=rules_version,
                categories_json="[]",
                templates_json="[]",
                alerts_json="[]",
                started_at=started_at or _now(),
            )
        )
        self._s.commit()
        return code

    def mark_closed(self, case: FunnelCase, status: str) -> None:
        """Closed, with nothing recorded (an interview whose result cannot be rebuilt)."""
        case.status = status
        case.closed_at = _now()
        self._s.commit()

    def get(self, code: str) -> FunnelCase | None:
        return self._s.get(FunnelCase, code)

    def for_session(self, session_id: str) -> FunnelCase | None:
        return self._s.scalars(
            select(FunnelCase).where(FunnelCase.session_id == session_id)
        ).first()

    def last_record(self, code: str) -> FunnelCaseRecord | None:
        return self._s.scalars(
            select(FunnelCaseRecord)
            .where(FunnelCaseRecord.case_code == code)
            .order_by(FunnelCaseRecord.id.desc())
        ).first()

    def close(
        self,
        case: FunnelCase,
        *,
        status: str,
        summary: dict[str, Any],
        record: dict[str, Any],
        reconstructed: bool = False,
    ) -> None:
        """The interview closed: what it showed is frozen, and the summary follows it."""
        case.status = status
        case.closed_at = _now()
        case.main_action = summary["main_action"]
        case.stopped_by = summary["stopped_by"]
        case.categories_json = json.dumps(summary["categories"])
        case.templates_json = json.dumps(summary["templates"])
        case.alerts_json = json.dumps(summary["alerts"])
        self._s.add(
            FunnelCaseRecord(
                case_code=case.code,
                status=status,
                record_json=json.dumps(record, ensure_ascii=False),
                reconstructed=reconstructed,
                recorded_at=case.closed_at,
            )
        )
        self._s.commit()

    def reopen(self, case: FunnelCase) -> None:
        if case.status == "open":
            return
        case.status = "open"
        case.closed_at = None
        self._s.commit()

    def add_change(self, code: str, withdrawn: list[dict[str, str]]) -> None:
        self._s.add(
            FunnelCaseChange(
                case_code=code,
                withdrawn_json=json.dumps(withdrawn, ensure_ascii=False),
                changed_at=_now(),
            )
        )
        self._s.commit()

    def add_access(self, code: str, actor_id: str, category: str, justification: str) -> None:
        self._s.add(
            FunnelCaseAccess(
                case_code=code,
                actor_id=actor_id,
                category=category,
                justification=justification,
                accessed_at=_now(),
            )
        )
        self._s.commit()

    def records(self, code: str) -> list[FunnelCaseRecord]:
        return list(
            self._s.scalars(
                select(FunnelCaseRecord)
                .where(FunnelCaseRecord.case_code == code)
                .order_by(FunnelCaseRecord.id)
            )
        )

    def changes(self, code: str) -> list[FunnelCaseChange]:
        return list(
            self._s.scalars(
                select(FunnelCaseChange)
                .where(FunnelCaseChange.case_code == code)
                .order_by(FunnelCaseChange.id)
            )
        )

    def accesses(self, code: str) -> list[FunnelCaseAccess]:
        return list(
            self._s.scalars(
                select(FunnelCaseAccess)
                .where(FunnelCaseAccess.case_code == code)
                .order_by(FunnelCaseAccess.id)
            )
        )

    def started_between(self, start: datetime | None, end: datetime | None) -> list[FunnelCase]:
        stmt = select(FunnelCase)
        if start is not None:
            stmt = stmt.where(FunnelCase.started_at >= start)
        if end is not None:
            stmt = stmt.where(FunnelCase.started_at < end)
        return list(self._s.scalars(stmt))

    # --- the interview goes, the case stays ---

    def unlink_sessions(self, session_ids: list[str]) -> None:
        """Break the link to deleted interviews. Not committed: the caller's delete is."""
        if session_ids:
            self._s.execute(
                update(FunnelCase)
                .where(FunnelCase.session_id.in_(session_ids))
                .values(session_id=None),
                execution_options=_SYNC,
            )

    def delete_started_before(self, cutoff: datetime) -> int:
        """Cases past the legal retention period, with everything recorded about them."""
        codes = list(self._s.scalars(select(FunnelCase.code).where(FunnelCase.started_at < cutoff)))
        if not codes:
            return 0
        for model in (FunnelCaseRecord, FunnelCaseChange, FunnelCaseAccess):
            self._s.execute(
                delete(model).where(model.case_code.in_(codes)), execution_options=_SYNC
            )
        result = cast(
            "CursorResult[Any]",
            self._s.execute(
                delete(FunnelCase).where(FunnelCase.code.in_(codes)), execution_options=_SYNC
            ),
        )
        self._s.commit()
        return result.rowcount
