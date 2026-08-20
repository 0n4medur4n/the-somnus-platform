"""Retention deletes (build plan §20 Checkpoint 12.2) against the real schema.

Endpoint-driven: exercises the full HTTP path on fresh per-request sessions and
covers api/maintenance.py. Uses unique ids and a fixed past cutoff, so it never
collides with other tests' present-day rows and needs no global truncation.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from morpheo.infrastructure.models import (
    AssessmentClaimToken,
    AssessmentSession,
)
from morpheo.main import create_app

NOW = datetime(2026, 8, 20, 12, 0, tzinfo=UTC).replace(tzinfo=None)


@pytest.fixture
def client(engine: Engine) -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


def _open_session(session_id: str, created_at: datetime) -> AssessmentSession:
    return AssessmentSession(
        id=session_id,
        role="adult",
        base_orientation="general",
        consent_given=True,
        status="open",
        workflow_version="1.0",
        created_at=created_at,
    )


def _drop(session: Session, session_id: str) -> None:
    """Remove one seeded session (and its children) by id — never touches other data."""
    session.query(AssessmentClaimToken).filter_by(session_id=session_id).delete(
        synchronize_session=False
    )
    existing = session.get(AssessmentSession, session_id)
    if existing is not None:
        session.delete(existing)  # ORM cascade removes its answers
    session.commit()


def test_unclaimed_delete_endpoint_purges_only_the_old_open_session(
    client: TestClient, db_session: Session
) -> None:
    old_id, recent_id = "maint-old-open", "maint-recent-open"
    _drop(db_session, old_id)
    _drop(db_session, recent_id)
    db_session.add(_open_session(old_id, NOW - timedelta(days=40)))
    db_session.add(_open_session(recent_id, NOW - timedelta(days=5)))
    db_session.commit()

    response = client.post(
        "/internal/v1/maintenance/unclaimed-assessments/delete",
        json={"before": (NOW - timedelta(days=30)).isoformat()},
    )

    assert response.status_code == 200
    assert response.json()["deleted"] >= 1

    db_session.expire_all()
    assert db_session.get(AssessmentSession, old_id) is None  # old open -> purged
    assert db_session.get(AssessmentSession, recent_id) is not None  # recent -> survives
    _drop(db_session, recent_id)


def test_claim_token_delete_endpoint_purges_old_tokens(
    client: TestClient, db_session: Session
) -> None:
    session_id = "maint-tok-session"
    _drop(db_session, session_id)
    # Commit the parent session first: AssessmentClaimToken has only a column-level
    # ForeignKey (no ORM relationship), so the unit of work won't order its insert
    # after the session's within a single flush.
    db_session.add(_open_session(session_id, NOW - timedelta(days=1)))
    db_session.commit()
    old = NOW - timedelta(hours=100)
    db_session.add(
        AssessmentClaimToken(
            token="maint-tok-old", session_id=session_id, expires_at=old, created_at=old
        )
    )
    db_session.commit()

    response = client.post(
        "/internal/v1/maintenance/claim-tokens/delete",
        json={"before": (NOW - timedelta(hours=72)).isoformat()},
    )

    assert response.status_code == 200
    assert response.json()["deleted"] >= 1

    db_session.expire_all()
    remaining = db_session.scalars(
        select(AssessmentClaimToken).filter_by(session_id=session_id)
    ).all()
    assert remaining == []
    _drop(db_session, session_id)
