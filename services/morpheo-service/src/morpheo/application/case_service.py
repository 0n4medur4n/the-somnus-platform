"""The console's two reads of the case records (ADR 0024).

Statistics are counts over cases and nothing else: no case code, no answer, no
person leaves in them. Opening one case is the exception, and it is recorded
before anything is read: the access row is committed first, so a case cannot be
read without its access being on file, even if the response never arrives.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from morpheo.infrastructure.models import FunnelCase
from morpheo.repositories.cases import CaseRepository, normalise_code
from morpheo.schemas.cases import (
    FunnelCaseAccessDTO,
    FunnelCaseChangeDTO,
    FunnelCaseDTO,
    FunnelCaseOpenRequestDTO,
    FunnelCaseRecordDTO,
    FunnelCaseStatsDTO,
    FunnelCaseStatsRequestDTO,
    FunnelCountDTO,
    FunnelMonthDTO,
    FunnelStatusCountsDTO,
)
from morpheo.schemas.funnel import FunnelHistoryItemDTO


def _naive_utc(moment: datetime | None) -> datetime | None:
    if moment is None or moment.tzinfo is None:
        return moment
    return moment.astimezone(UTC).replace(tzinfo=None)


def _iso(moment: datetime) -> str:
    return moment.replace(tzinfo=UTC).isoformat()


def _counts(counter: Counter[str]) -> list[FunnelCountDTO]:
    """Most frequent first; ties by key, so the order is stable."""
    return [
        FunnelCountDTO(key=k, count=n)
        for k, n in sorted(counter.items(), key=lambda i: (-i[1], i[0]))
    ]


class CaseService:
    def __init__(self, session: Session) -> None:
        self._cases = CaseRepository(session)

    def stats(self, window: FunnelCaseStatsRequestDTO) -> FunnelCaseStatsDTO:
        rows = self._cases.started_between(_naive_utc(window.since), _naive_utc(window.until))
        statuses = Counter(r.status for r in rows)
        closed = [r for r in rows if r.status != "open"]
        main = Counter(r.main_action for r in closed if r.main_action)
        templates: Counter[str] = Counter()
        alerts: Counter[str] = Counter()
        with_alerts = 0
        for r in closed:
            # A template counts once per case, however many texts it gave.
            templates.update(set(json.loads(r.templates_json)))
            case_alerts = set(json.loads(r.alerts_json))
            alerts.update(case_alerts)
            with_alerts += bool(case_alerts)
        started_by_month = Counter(r.started_at.strftime("%Y-%m") for r in rows)
        closed_by_month = Counter(
            r.closed_at.strftime("%Y-%m") for r in closed if r.closed_at is not None
        )
        months = sorted(set(started_by_month) | set(closed_by_month))
        starts = sorted(r.started_at for r in rows)
        return FunnelCaseStatsDTO(
            started=len(rows),
            by_status=FunnelStatusCountsDTO(
                open=statuses["open"],
                finished=statuses["finished"],
                stopped=statuses["stopped"],
                paused=statuses["paused"],
            ),
            closed=len(closed),
            by_main_action=_counts(main),
            by_template=_counts(templates),
            by_alert=_counts(alerts),
            with_alerts=with_alerts,
            by_month=[
                FunnelMonthDTO(month=m, started=started_by_month[m], closed=closed_by_month[m])
                for m in months
            ],
            first_started_at=_iso(starts[0]) if starts else None,
            last_started_at=_iso(starts[-1]) if starts else None,
        )

    def open(self, request: FunnelCaseOpenRequestDTO, actor_id: str) -> FunnelCaseDTO | None:
        """One case, by its code. The access is on file before anything is read."""
        code = normalise_code(request.case_code)
        case = None if code is None else self._cases.get(code)
        if case is None:
            return None
        self._cases.add_access(case.code, actor_id, request.category, request.justification.strip())
        return self._view(case)

    def _view(self, case: FunnelCase) -> FunnelCaseDTO:
        records = []
        for r in self._cases.records(case.code):
            stored = json.loads(r.record_json)
            records.append(
                FunnelCaseRecordDTO(
                    recorded_at=_iso(r.recorded_at),
                    status=r.status,
                    reconstructed=r.reconstructed,
                    content_version=stored["contentVersion"],
                    rules_version=stored["rulesVersion"],
                    history=[FunnelHistoryItemDTO.model_validate(h) for h in stored["history"]],
                    result=stored["result"],
                )
            )
        return FunnelCaseDTO(
            case_code=case.code,
            status=case.status,
            started_at=_iso(case.started_at),
            closed_at=None if case.closed_at is None else _iso(case.closed_at),
            content_version=case.content_version,
            rules_version=case.rules_version,
            interview_deleted=case.session_id is None,
            records=records,
            changes=[
                FunnelCaseChangeDTO(
                    changed_at=_iso(c.changed_at),
                    withdrawn=[
                        FunnelHistoryItemDTO.model_validate(w) for w in json.loads(c.withdrawn_json)
                    ],
                )
                for c in self._cases.changes(case.code)
            ],
            accesses=[
                FunnelCaseAccessDTO(
                    accessed_at=_iso(a.accessed_at),
                    actor_id=a.actor_id,
                    category=a.category,
                    justification=a.justification,
                )
                for a in self._cases.accesses(case.code)
            ],
        )
