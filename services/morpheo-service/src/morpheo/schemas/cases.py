"""The case record DTOs (ADR 0024): the Python side of
`packages/api-contracts/src/morpheo/cases.ts`.

Two reads, for the console only, through the edge: aggregate statistics (no
case, no person, only counts) and one case opened by its code, which requires a
category and a justification and records the access before answering.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from morpheo.schemas.base import ContractModel
from morpheo.schemas.funnel import FunnelHistoryItemDTO, FunnelStatus

CaseAccessCategory = Literal["support", "safety", "legal", "other"]


class FunnelCaseStatsRequestDTO(ContractModel):
    since: datetime | None = None
    until: datetime | None = None


class FunnelCountDTO(ContractModel):
    key: str
    count: int


class FunnelStatusCountsDTO(ContractModel):
    open: int
    finished: int
    stopped: int
    paused: int


class FunnelMonthDTO(ContractModel):
    month: str  # YYYY-MM, UTC
    started: int
    closed: int


class FunnelCaseStatsDTO(ContractModel):
    started: int
    by_status: FunnelStatusCountsDTO
    # Over the cases that closed: what the last closure showed.
    closed: int
    by_main_action: list[FunnelCountDTO]
    by_template: list[FunnelCountDTO]
    by_alert: list[FunnelCountDTO]
    with_alerts: int
    by_month: list[FunnelMonthDTO]
    first_started_at: str | None
    last_started_at: str | None


class FunnelCaseOpenRequestDTO(ContractModel):
    case_code: str = Field(min_length=1, max_length=32)
    category: CaseAccessCategory
    justification: str = Field(min_length=20, max_length=500)


class FunnelCaseRecordDTO(ContractModel):
    recorded_at: str
    status: FunnelStatus
    reconstructed: bool
    content_version: str
    rules_version: str
    history: list[FunnelHistoryItemDTO]
    # The result exactly as it was serialised when the person saw it. Kept as
    # stored, not re-validated: a later change to the result contract must not
    # make an old record unreadable.
    result: dict[str, Any]


class FunnelCaseChangeDTO(ContractModel):
    changed_at: str
    withdrawn: list[FunnelHistoryItemDTO]


class FunnelCaseAccessDTO(ContractModel):
    accessed_at: str
    actor_id: str
    category: CaseAccessCategory
    justification: str


class FunnelCaseDTO(ContractModel):
    case_code: str
    status: FunnelStatus
    started_at: str
    closed_at: str | None
    content_version: str
    rules_version: str
    # True once the interview itself was deleted (TTL or account erasure): the
    # case then has no link left to anyone.
    interview_deleted: bool
    records: list[FunnelCaseRecordDTO]
    changes: list[FunnelCaseChangeDTO]
    accesses: list[FunnelCaseAccessDTO]


class FunnelCaseBackfillResultDTO(ContractModel):
    opened: int
    unrebuilt: int
