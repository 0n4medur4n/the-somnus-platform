"""The review queue against a real MySQL (Checkpoint 15.3, build plan §19).

The in-memory port in `tests/unit` proves the rules; this proves the SQL
implementation of them, and one rule can only be proven here: a decision is final
because the UPDATE carries `status = 'pending_review'` in its WHERE clause, not
because a read-then-write happened to be uncontended. That is what makes reviewer
identity and decision timestamp immutable on an approved item.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import Session

from report.application.content_review import (
    STATUS_APPROVED,
    STATUS_PENDING,
    STATUS_REJECTED,
    ContentReviewService,
    ReviewDecisionError,
)
from report.infrastructure.forbidden import ForbiddenPhraseScanner
from report.infrastructure.models import AiContentReviewItemRow
from report.repositories.content_review_repository import ContentReviewRepositorySql

BLOQUEAR_CLAIM = "Esto confirma que padeces apnea del sueño"
CANDIDATE = "Tus respuestas sugieren revisar tus horarios de descanso."
DETERMINISTIC = "El resultado estructurado aprobado."
REPORT = "report-15-3"


@pytest.fixture
def service(db_session: Session) -> Iterator[ContentReviewService]:
    db_session.execute(delete(AiContentReviewItemRow))
    db_session.commit()
    yield ContentReviewService(ContentReviewRepositorySql(db_session))
    db_session.execute(delete(AiContentReviewItemRow))
    db_session.commit()


@pytest.fixture
def scanner() -> ForbiddenPhraseScanner:
    return ForbiddenPhraseScanner(forbidden_phrases=[], blocked_claims=[BLOQUEAR_CLAIM])


def _enqueue(
    service: ContentReviewService, scanner: ForbiddenPhraseScanner, text: str
) -> str | None:
    item = service.enqueue(
        report_id=REPORT,
        deterministic_text=DETERMINISTIC,
        candidate_text=text,
        scanner=scanner,
        model_id="gpt-5.6",
        prompt_template_version="v1",
        prompt_template_id="rewrite_plain_language",
    )
    return None if item is None else item.item_id


def test_a_blocked_candidate_is_never_written_to_the_table(
    service: ContentReviewService, scanner: ForbiddenPhraseScanner, db_session: Session
) -> None:
    assert _enqueue(service, scanner, BLOQUEAR_CLAIM) is None

    # Not "written but hidden": there is no row at all, so no query, migration, or
    # future screen can surface it as reviewable.
    assert db_session.query(AiContentReviewItemRow).count() == 0
    assert list(service.pending()) == []


def test_a_queued_item_round_trips_with_its_generation_record(
    service: ContentReviewService, scanner: ForbiddenPhraseScanner, db_session: Session
) -> None:
    item_id = _enqueue(service, scanner, CANDIDATE)
    assert item_id is not None
    db_session.commit()

    stored = service.get(item_id)
    assert stored is not None
    assert stored.status == STATUS_PENDING
    assert stored.report_id == REPORT
    assert stored.model_id == "gpt-5.6"
    assert len(stored.input_hash) == 64
    assert len(stored.output_hash) == 64
    assert stored.deterministic_text == DETERMINISTIC
    assert stored.candidate_text == CANDIDATE
    assert stored.reviewer_id is None
    assert stored.decided_at is None
    assert stored.reason is None


def test_only_an_approved_row_is_renderable(
    service: ContentReviewService, scanner: ForbiddenPhraseScanner, db_session: Session
) -> None:
    item_id = _enqueue(service, scanner, CANDIDATE)
    assert item_id is not None
    db_session.commit()
    assert service.approved_candidate(REPORT) is None  # pending

    service.decide(
        item_id, status=STATUS_REJECTED, reviewer_id="rev-1", reason="reads as a diagnosis"
    )
    db_session.commit()
    assert service.approved_candidate(REPORT) is None  # rejected

    other = _enqueue(service, scanner, CANDIDATE)
    assert other is not None
    service.decide(other, status=STATUS_APPROVED, reviewer_id="rev-2", reason="faithful wording")
    db_session.commit()
    assert service.approved_candidate(REPORT) == CANDIDATE


def test_a_decision_is_final_at_the_database_level(
    service: ContentReviewService, scanner: ForbiddenPhraseScanner, db_session: Session
) -> None:
    item_id = _enqueue(service, scanner, CANDIDATE)
    assert item_id is not None
    db_session.commit()

    approved = service.decide(
        item_id, status=STATUS_APPROVED, reviewer_id="rev-1", reason="faithful wording"
    )
    db_session.commit()

    # A second decision matches no row: the WHERE clause requires pending_review.
    with pytest.raises(ReviewDecisionError):
        service.decide(
            item_id, status=STATUS_REJECTED, reviewer_id="rev-2", reason="changed my mind"
        )
    db_session.commit()

    after = service.get(item_id)
    assert after is not None
    assert after.status == STATUS_APPROVED
    assert after.reviewer_id == "rev-1"
    assert after.decided_at == approved.decided_at
    assert after.reason == "faithful wording"


def test_the_queue_lists_only_pending_rows(
    service: ContentReviewService, scanner: ForbiddenPhraseScanner, db_session: Session
) -> None:
    decided = _enqueue(service, scanner, CANDIDATE)
    still_open = _enqueue(service, scanner, f"{CANDIDATE} Otra redaccion.")
    assert decided is not None and still_open is not None
    service.decide(decided, status=STATUS_APPROVED, reviewer_id="rev-1", reason="fine as written")
    db_session.commit()

    assert [item.item_id for item in service.pending()] == [still_open]
