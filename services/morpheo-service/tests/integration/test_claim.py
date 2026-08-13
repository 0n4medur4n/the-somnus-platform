"""Single-use claim token + immutable snapshot (build plan §20 Checkpoint 10.2)."""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from morpheo.application.assessment_flow import AssessmentFlow
from morpheo.application.events import RecordingEventPublisher
from morpheo.clinical.loader import load_clinical
from morpheo.clinical.models import RoleId
from morpheo.settings.config import load_settings

BUNDLE = load_clinical()


def _new_session(db_session: Session) -> tuple[AssessmentFlow, str]:
    flow = AssessmentFlow(db_session, BUNDLE, RecordingEventPublisher())
    created = flow.create(role=RoleId.ADULT, age_years=30, consent_given=True)
    assert created.session_id is not None
    return flow, created.session_id


def test_expired_token_cannot_be_claimed(db_session: Session) -> None:
    flow, sid = _new_session(db_session)
    token = flow.request_claim_token(sid)
    db_session.execute(
        text("UPDATE assessment_claim_tokens SET expires_at = :d WHERE token = :t"),
        {"d": datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=1), "t": token},
    )
    db_session.commit()

    outcome = flow.claim(token, claimed_by="user-1")
    assert outcome.success is False
    assert outcome.reason == "already_claimed_or_expired"
    assert flow.get_snapshot(sid) is None


def test_reused_token_is_rejected(db_session: Session) -> None:
    flow, sid = _new_session(db_session)
    token = flow.request_claim_token(sid)

    first = flow.claim(token, claimed_by="user-1")
    assert first.success is True

    second = flow.claim(token, claimed_by="user-2")
    assert second.success is False
    assert second.reason == "already_claimed_or_expired"


def test_snapshot_is_written_once_and_never_mutated(db_session: Session) -> None:
    flow, sid = _new_session(db_session)
    flow.submit_signal(sid, "sleepiness_near_miss", True)
    token = flow.request_claim_token(sid)

    flow.claim(token, claimed_by="user-1")
    first = flow.get_snapshot(sid)
    assert first is not None
    original_id = first.id
    original_json = first.result_json

    # A rejected re-claim must not create or overwrite the frozen snapshot.
    flow.claim(token, claimed_by="user-2")
    second = flow.get_snapshot(sid)
    assert second is not None
    assert second.id == original_id
    assert second.result_json == original_json
    assert second.claimed_by == "user-1"


def test_claim_is_exactly_once_under_concurrency(db_session: Session) -> None:
    flow, sid = _new_session(db_session)
    token = flow.request_claim_token(sid)

    workers = 10
    engine = create_engine(load_settings().database_url, pool_size=workers + 2, max_overflow=4)
    barrier = threading.Barrier(workers)
    lock = threading.Lock()
    successes: list[bool] = []

    def claim_worker(index: int) -> None:
        barrier.wait()  # release all threads at once so they truly race
        with Session(engine) as scoped:
            racer = AssessmentFlow(scoped, BUNDLE, RecordingEventPublisher())
            outcome = racer.claim(token, claimed_by=f"user-{index}")
        with lock:
            successes.append(outcome.success)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(claim_worker, range(workers)))
    engine.dispose()

    assert sum(1 for ok in successes if ok) == 1  # exactly one winner
    assert flow.get_snapshot(sid) is not None
