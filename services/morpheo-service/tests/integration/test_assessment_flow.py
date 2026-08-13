"""The anonymous assessment flow end to end (build plan §20 Checkpoint 10.2)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from morpheo.application.assessment_flow import AssessmentFlow
from morpheo.application.events import (
    ASSESSMENT_COMPLETED,
    ASSESSMENT_CREATED,
    REPORT_REQUESTED,
    RecordingEventPublisher,
)
from morpheo.clinical.loader import load_clinical
from morpheo.clinical.models import ModuleId, RoleId, SafetyLevelId
from morpheo.repositories.assessment import AssessmentRepository

BUNDLE = load_clinical()


def _flow(db_session: Session) -> tuple[AssessmentFlow, RecordingEventPublisher]:
    publisher = RecordingEventPublisher()
    return AssessmentFlow(db_session, BUNDLE, publisher), publisher


def test_full_anonymous_flow_create_answer_reeval_claim_snapshot(db_session: Session) -> None:
    flow, pub = _flow(db_session)
    created = flow.create(role=RoleId.ADULT, age_years=35, consent_given=True)
    assert created.allowed
    assert created.session_id is not None
    session_id = created.session_id

    flow.submit_complaint(session_id, "somnolencia al volante")
    result = flow.submit_signal(session_id, "sleepiness_near_miss", True)
    assert result is not None
    assert result.level is SafetyLevelId.L1
    assert result.stop is True
    assert result.routes == frozenset({ModuleId.SLP})

    token = flow.request_claim_token(session_id)
    outcome = flow.claim(token, claimed_by="user-1")
    assert outcome.success
    assert outcome.snapshot_id is not None

    snapshot = flow.get_snapshot(session_id)
    assert snapshot is not None
    assert snapshot.claimed_by == "user-1"
    assert '"level": "L1"' in snapshot.result_json
    assert snapshot.workflow_version == BUNDLE.workflows.meta.version

    assert ASSESSMENT_CREATED in pub.types()
    assert ASSESSMENT_COMPLETED in pub.types()
    assert REPORT_REQUESTED in pub.types()


def test_safety_reevaluation_per_answer_only_escalates(db_session: Session) -> None:
    flow, _ = _flow(db_session)
    created = flow.create(
        role=RoleId.ADULT, age_years=40, consent_given=True, base_orientation=SafetyLevelId.L3
    )
    assert created.session_id is not None
    sid = created.session_id

    first = flow.submit_complaint(sid, "ronquido")
    assert first is not None
    assert first.level is SafetyLevelId.L3  # base orientation, no safety rule yet

    flow.submit_signal(sid, "witnessed_apneas", True)
    escalated = flow.submit_signal(sid, "significant_deterioration", True)  # SAFE-006 -> L1
    assert escalated is not None
    assert escalated.level is SafetyLevelId.L1
    assert "SAFE-006" in escalated.triggered_rule_ids


def test_professional_identifiable_data_blocks_creation(db_session: Session) -> None:
    flow, _ = _flow(db_session)
    outcome = flow.create(
        role=RoleId.PROFESSIONAL,
        professional_confirmed=True,
        contains_identifiable_data=True,
        consent_given=True,
    )
    assert outcome.allowed is False
    assert outcome.reason == "privacy_block"
    assert outcome.session_id is None


def test_missing_consent_blocks_creation(db_session: Session) -> None:
    flow, _ = _flow(db_session)
    outcome = flow.create(role=RoleId.ADULT, age_years=30, consent_given=False)
    assert outcome.allowed is False
    assert outcome.reason == "consent_required"


def test_parent_flow_stores_no_minor_identity_and_stays_adult_directed(db_session: Session) -> None:
    flow, _ = _flow(db_session)
    created = flow.create(
        role=RoleId.PARENT,
        age_years=8,
        guardianship_confirmed=True,
        consent_given=True,
        base_orientation=SafetyLevelId.L2,
    )
    assert created.session_id is not None
    result = flow.summary(created.session_id)
    assert result is not None
    # The output is addressed to the adult; the minor never converses directly.
    assert result.role is RoleId.PARENT
    session = AssessmentRepository(db_session).get_session(created.session_id)
    assert session is not None
    # Only role + the minor's age band; no name/address/identifier column exists.
    assert session.role == "parent"
    assert session.age_years == 8


def test_ttl_returns_only_old_unclaimed_sessions(db_session: Session) -> None:
    flow, _ = _flow(db_session)
    old = flow.create(role=RoleId.ADULT, age_years=30, consent_given=True).session_id
    fresh = flow.create(role=RoleId.ADULT, age_years=30, consent_given=True).session_id
    assert old is not None and fresh is not None

    db_session.execute(
        text("UPDATE assessment_sessions SET created_at = :d WHERE id = :id"),
        {"d": datetime.now(UTC).replace(tzinfo=None) - timedelta(days=40), "id": old},
    )
    db_session.commit()

    stale = flow.ttl_unclaimed(older_than_days=30)
    assert old in stale
    assert fresh not in stale
