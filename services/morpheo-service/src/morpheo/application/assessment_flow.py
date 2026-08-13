"""The anonymous assessment flow (build plan §20 Checkpoint 10.2 / §14).

create session -> incremental validated answers -> safety re-evaluation per
answer (the pure engine) -> deterministic results -> preliminary summary ->
authenticate -> claim exactly once (single-use token, 72 h) -> immutable
snapshot -> async report request. The flow is anonymous: no names, addresses,
or identifiers are ever stored (§14 privacy).
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from morpheo.application.events import (
    ASSESSMENT_COMPLETED,
    ASSESSMENT_CREATED,
    REPORT_REQUESTED,
    EventPublisher,
    make_event,
)
from morpheo.application.gating import enforce_entry_gate
from morpheo.clinical.loader import ClinicalBundle
from morpheo.clinical.models import RoleId, SafetyLevelId
from morpheo.domain.engine import AssessmentInput, AssessmentResult, run_assessment
from morpheo.infrastructure.models import AssessmentSession, AssessmentSnapshot
from morpheo.repositories.assessment import AssessmentRepository

CLAIM_TTL_HOURS = 72
UNCLAIMED_TTL_DAYS = 30


def _now() -> datetime:
    # Naive UTC to match the DATETIME columns.
    return datetime.now(UTC).replace(tzinfo=None)


@dataclass(frozen=True)
class CreateOutcome:
    session_id: str | None
    allowed: bool
    reason: str | None


@dataclass(frozen=True)
class ClaimOutcome:
    success: bool
    reason: str | None
    snapshot_id: str | None


def _result_json(result: AssessmentResult) -> str:
    return json.dumps(
        {
            "role": result.role.value,
            "level": result.level.value if result.level is not None else None,
            "stop": result.stop,
            "privacyBlock": result.privacy_block,
            "routes": sorted(module.value for module in result.routes),
            "triggeredRules": list(result.triggered_rule_ids),
            "workflowVersion": result.workflow_version,
            "contentVersion": result.content_version,
        }
    )


class AssessmentFlow:
    def __init__(self, session: Session, bundle: ClinicalBundle, publisher: EventPublisher) -> None:
        self._repo = AssessmentRepository(session)
        self._bundle = bundle
        self._pub = publisher

    def create(
        self,
        *,
        role: RoleId,
        consent_given: bool,
        age_years: int | None = None,
        guardianship_confirmed: bool | None = None,
        professional_confirmed: bool | None = None,
        contains_identifiable_data: bool = False,
        base_orientation: SafetyLevelId = SafetyLevelId.L4,
        correlation_id: str = "morpheo",
    ) -> CreateOutcome:
        probe = AssessmentInput(
            role=role,
            age_years=age_years,
            guardianship_confirmed=guardianship_confirmed,
            professional_confirmed=professional_confirmed,
            contains_identifiable_data=contains_identifiable_data,
            base_orientation=base_orientation,
        )
        gate = enforce_entry_gate(probe, consent_given=consent_given)
        if not gate.allowed:
            return CreateOutcome(session_id=None, allowed=False, reason=gate.reason)

        session_id = uuid.uuid4().hex
        version = self._bundle.workflows.meta.version
        self._repo.create_session(
            AssessmentSession(
                id=session_id,
                role=role.value,
                age_years=age_years,
                guardianship_confirmed=guardianship_confirmed,
                professional_confirmed=professional_confirmed,
                base_orientation=base_orientation.value,
                consent_given=consent_given,
                status="open",
                workflow_version=version,
            )
        )
        payload = json.dumps({"role": role.value})
        self._repo.add_audit(session_id, ASSESSMENT_CREATED, payload)
        self._pub.publish(
            make_event(ASSESSMENT_CREATED, session_id, {"role": role.value}, correlation_id)
        )
        return CreateOutcome(session_id=session_id, allowed=True, reason=None)

    def submit_complaint(self, session_id: str, phrase: str) -> AssessmentResult | None:
        self._repo.add_answer(session_id, "complaint", phrase, None)
        return self.summary(session_id)

    def submit_signal(
        self, session_id: str, name: str, value: bool | None
    ) -> AssessmentResult | None:
        encoded = "unknown" if value is None else ("true" if value else "false")
        self._repo.add_answer(session_id, "signal", name, encoded)
        return self.summary(session_id)

    def summary(self, session_id: str) -> AssessmentResult | None:
        session = self._repo.get_session(session_id)
        if session is None:
            return None
        return run_assessment(self._input_for(session), self._bundle)

    def request_claim_token(self, session_id: str, token: str | None = None) -> str:
        value = token or uuid.uuid4().hex
        self._repo.create_token(value, session_id, _now() + timedelta(hours=CLAIM_TTL_HOURS))
        return value

    def claim(
        self, token: str, *, claimed_by: str, correlation_id: str = "morpheo"
    ) -> ClaimOutcome:
        session_id = self._repo.claim_token_atomic(token, claimed_by, _now())
        if session_id is None:
            return ClaimOutcome(
                success=False, reason="already_claimed_or_expired", snapshot_id=None
            )

        result = self.summary(session_id)
        assert result is not None  # the token references an existing session
        snapshot_id = uuid.uuid4().hex
        self._repo.create_snapshot(
            AssessmentSnapshot(
                id=snapshot_id,
                session_id=session_id,
                claimed_by=claimed_by,
                result_json=_result_json(result),
                workflow_version=result.workflow_version,
                content_version=result.content_version,
            )
        )
        self._repo.set_status(session_id, "claimed")
        # The clinical result stays in the access-controlled snapshot; §17 forbids
        # broadcasting answer collections / free text on the bus, so events carry
        # only opaque ids + the version stamp. The in-DB audit trail (§14) may keep
        # the structured level for the Safety Committee — it is not a log or the bus.
        level = result.level.value if result.level is not None else None
        self._repo.add_audit(session_id, ASSESSMENT_COMPLETED, json.dumps({"level": level}))
        completed_data = {"snapshotId": snapshot_id, "workflowVersion": result.workflow_version}
        self._pub.publish(
            make_event(ASSESSMENT_COMPLETED, session_id, completed_data, correlation_id)
        )
        self._pub.publish(
            make_event(REPORT_REQUESTED, session_id, {"snapshotId": snapshot_id}, correlation_id)
        )
        return ClaimOutcome(success=True, reason=None, snapshot_id=snapshot_id)

    def get_snapshot(self, session_id: str) -> AssessmentSnapshot | None:
        return self._repo.get_snapshot(session_id)

    def ttl_unclaimed(self, older_than_days: int = UNCLAIMED_TTL_DAYS) -> list[str]:
        return self._repo.unclaimed_older_than(_now() - timedelta(days=older_than_days))

    def _input_for(self, session: AssessmentSession) -> AssessmentInput:
        complaints: set[str] = set()
        answers: dict[str, bool | None] = {}
        for answer in self._repo.answers(session.id):
            if answer.kind == "complaint":
                complaints.add(answer.name)
            else:
                answers[answer.name] = None if answer.value == "unknown" else answer.value == "true"
        return AssessmentInput(
            role=RoleId(session.role),
            age_years=session.age_years,
            guardianship_confirmed=session.guardianship_confirmed,
            professional_confirmed=session.professional_confirmed,
            base_orientation=SafetyLevelId(session.base_orientation),
            complaints=frozenset(complaints),
            safety_answers=answers,
        )
