"""Retention deletes (build plan §20 Checkpoint 12.2) against the real schema."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from morpheo.infrastructure.models import (
    AssessmentAnswer,
    AssessmentClaimToken,
    AssessmentSession,
    AssessmentSnapshot,
)
from morpheo.main import create_app
from morpheo.repositories.assessment import AssessmentRepository

NOW = datetime(2026, 8, 20, 12, 0, tzinfo=UTC).replace(tzinfo=None)


@pytest.fixture
def client(engine: Engine) -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


def _clear(session: Session) -> None:
    # FK-safe order: every child of assessment_sessions before the sessions
    # themselves (a prior test's claim flow leaves a snapshot referencing one).
    session.query(AssessmentAnswer).delete()
    session.query(AssessmentClaimToken).delete()
    session.query(AssessmentSnapshot).delete()
    session.query(AssessmentSession).delete()
    session.commit()


def _session_row(session_id: str, status: str, created_at: datetime) -> AssessmentSession:
    return AssessmentSession(
        id=session_id,
        role="adult",
        base_orientation="general",
        consent_given=True,
        status=status,
        workflow_version="1.0",
        created_at=created_at,
    )


def test_delete_unclaimed_before_purges_sessions_answers_and_tokens(db_session: Session) -> None:
    _clear(db_session)
    old = NOW - timedelta(days=40)
    recent = NOW - timedelta(days=5)

    db_session.add(_session_row("old-open", "open", old))
    db_session.add(_session_row("recent-open", "open", recent))
    db_session.add(_session_row("old-claimed", "claimed", old))
    db_session.add(AssessmentAnswer(session_id="old-open", kind="signal", name="x", value="true"))
    db_session.add(
        AssessmentClaimToken(token="t-old", session_id="old-open", expires_at=old, created_at=old)
    )
    db_session.commit()

    cutoff = NOW - timedelta(days=30)
    deleted = AssessmentRepository(db_session).delete_unclaimed_before(cutoff)

    assert deleted == 1  # only the old OPEN session
    remaining = {s.id for s in db_session.query(AssessmentSession).all()}
    assert remaining == {"recent-open", "old-claimed"}
    assert db_session.query(AssessmentAnswer).count() == 0
    assert db_session.query(AssessmentClaimToken).count() == 0
    _clear(db_session)


def test_delete_claim_tokens_before_purges_only_the_old_tokens(db_session: Session) -> None:
    _clear(db_session)
    db_session.add(_session_row("s1", "claimed", NOW - timedelta(days=1)))
    db_session.add(_session_row("s2", "claimed", NOW - timedelta(days=1)))
    old = NOW - timedelta(hours=100)
    recent = NOW - timedelta(hours=1)
    db_session.add(
        AssessmentClaimToken(token="t-old", session_id="s1", expires_at=old, created_at=old)
    )
    db_session.add(
        AssessmentClaimToken(
            token="t-recent", session_id="s2", expires_at=recent, created_at=recent
        )
    )
    db_session.commit()

    cutoff = NOW - timedelta(hours=72)
    deleted = AssessmentRepository(db_session).delete_claim_tokens_before(cutoff)

    assert deleted == 1
    remaining = {t.token for t in db_session.query(AssessmentClaimToken).all()}
    assert remaining == {"t-recent"}
    _clear(db_session)


def test_unclaimed_delete_endpoint_reports_the_count(
    client: TestClient, db_session: Session
) -> None:
    _clear(db_session)
    db_session.add(_session_row("ep-old", "open", NOW - timedelta(days=40)))
    db_session.commit()

    response = client.post(
        "/internal/v1/maintenance/unclaimed-assessments/delete",
        json={"before": (NOW - timedelta(days=30)).isoformat()},
    )

    assert response.status_code == 200
    assert response.json() == {"deleted": 1}
    _clear(db_session)


def test_claim_token_delete_endpoint_reports_the_count(
    client: TestClient, db_session: Session
) -> None:
    _clear(db_session)
    db_session.add(_session_row("ep-s", "claimed", NOW - timedelta(days=1)))
    old = NOW - timedelta(hours=100)
    db_session.add(
        AssessmentClaimToken(token="ep-tok", session_id="ep-s", expires_at=old, created_at=old)
    )
    db_session.commit()

    response = client.post(
        "/internal/v1/maintenance/claim-tokens/delete",
        json={"before": (NOW - timedelta(hours=72)).isoformat()},
    )

    assert response.status_code == 200
    assert response.json() == {"deleted": 1}
    _clear(db_session)
