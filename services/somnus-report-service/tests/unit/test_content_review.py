"""The AI content review queue (Checkpoint 15.3, closes the 11.2 deferral).

Build plan §15 requires human review before AI health text is released. These
prove the two properties the queue exists for, both of them negative:

* a candidate the forbidden-phrase scanner blocks never becomes reviewable, so a
  BLOQUEAR claim is never put in front of a reviewer to be approved by mistake;
* only an approved item is ever renderable -- rejected and pending have no code
  path out of the service at all.

Plus the decision rules: a reason is required in both directions (mirroring
Checkpoint 15.2's verification decisions), and a decision is final, which is what
makes reviewer identity and timestamp immutable.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

import pytest

from report.application.content_review import (
    STATUS_APPROVED,
    STATUS_PENDING,
    STATUS_REJECTED,
    ContentReviewItem,
    ContentReviewService,
    ReviewDecisionError,
)
from report.infrastructure.forbidden import ForbiddenPhraseScanner

BLOQUEAR_CLAIM = "Esto confirma que padeces apnea del sueño"
CLEAN_CANDIDATE = "Tus respuestas sugieren que conviene revisar tus horarios de descanso."
DETERMINISTIC = "El resultado estructurado aprobado, en su redaccion original."


@pytest.fixture
def scanner() -> ForbiddenPhraseScanner:
    return ForbiddenPhraseScanner(
        forbidden_phrases=["tienes [enfermedad]"],
        blocked_claims=[BLOQUEAR_CLAIM],
    )


@pytest.fixture
def service(make_review_service: Callable[[], ContentReviewService]) -> ContentReviewService:
    return make_review_service()


def _enqueue(
    service: ContentReviewService,
    scanner: ForbiddenPhraseScanner,
    *,
    candidate: str,
    report_id: str = "report-1",
) -> ContentReviewItem | None:
    return service.enqueue(
        report_id=report_id,
        deterministic_text=DETERMINISTIC,
        candidate_text=candidate,
        scanner=scanner,
        model_id="gpt-5.6",
        prompt_template_version="v1",
        prompt_template_id="rewrite_plain_language",
    )


class TestTheScannerRunsBeforeTheReviewerEverSeesAnything:
    def test_a_bloquear_claim_never_becomes_a_reviewable_item(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        # The whole point of ordering the scan first: the reviewer's judgement is
        # about wording, not about catching what a guardrail already prohibits.
        queued = _enqueue(service, scanner, candidate=BLOQUEAR_CLAIM)

        assert queued is None
        assert list(service.pending()) == []

    def test_a_forbidden_phrase_template_is_blocked_the_same_way(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        queued = _enqueue(service, scanner, candidate="Segun esto tienes narcolepsia grave.")

        assert queued is None
        assert list(service.pending()) == []

    def test_a_blocked_candidate_cannot_be_approved_because_it_does_not_exist(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        _enqueue(service, scanner, candidate=BLOQUEAR_CLAIM)

        # There is no item id to approve: it was never persisted. A reviewer
        # cannot reach it through any route.
        with pytest.raises(ReviewDecisionError):
            service.decide(
                "any-id", status=STATUS_APPROVED, reviewer_id="rev-1", reason="looks fine"
            )

    def test_a_clean_candidate_does_reach_the_queue(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        queued = _enqueue(service, scanner, candidate=CLEAN_CANDIDATE)

        assert queued is not None
        assert queued.status == STATUS_PENDING
        assert [item.item_id for item in service.pending()] == [queued.item_id]

    def test_the_queued_item_carries_the_section_15_generation_record(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        queued = _enqueue(service, scanner, candidate=CLEAN_CANDIDATE)

        assert queued is not None
        assert queued.model_id == "gpt-5.6"
        assert queued.prompt_template_version == "v1"
        # sha256 hex of the input and the output, so an approval can be traced to
        # the exact generation without storing the prose twice.
        assert len(queued.input_hash) == 64
        assert len(queued.output_hash) == 64
        assert queued.input_hash != queued.output_hash

    def test_the_reviewer_gets_both_texts_to_compare(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        queued = _enqueue(service, scanner, candidate=CLEAN_CANDIDATE)

        assert queued is not None
        assert queued.deterministic_text == DETERMINISTIC
        assert queued.candidate_text == CLEAN_CANDIDATE


class TestOnlyAnApprovedItemIsRenderable:
    def test_a_pending_item_is_not_renderable(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        _enqueue(service, scanner, candidate=CLEAN_CANDIDATE)

        assert service.approved_candidate("report-1") is None

    def test_a_rejected_item_is_not_renderable(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        queued = _enqueue(service, scanner, candidate=CLEAN_CANDIDATE)
        assert queued is not None
        service.decide(
            queued.item_id,
            status=STATUS_REJECTED,
            reviewer_id="rev-1",
            reason="reads as a diagnosis",
        )

        assert service.approved_candidate("report-1") is None

    def test_an_approved_item_is_renderable(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        queued = _enqueue(service, scanner, candidate=CLEAN_CANDIDATE)
        assert queued is not None
        service.decide(
            queued.item_id,
            status=STATUS_APPROVED,
            reviewer_id="rev-1",
            reason="faithful to the approved wording",
        )

        assert service.approved_candidate("report-1") == CLEAN_CANDIDATE

    def test_an_approval_for_another_report_does_not_leak_across(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        queued = _enqueue(service, scanner, candidate=CLEAN_CANDIDATE, report_id="report-1")
        assert queued is not None
        service.decide(queued.item_id, status=STATUS_APPROVED, reviewer_id="rev-1", reason="fine")

        assert service.approved_candidate("report-2") is None


class TestADecisionRequiresAReasonInBothDirections:
    @pytest.mark.parametrize("status", [STATUS_APPROVED, STATUS_REJECTED])
    @pytest.mark.parametrize("reason", ["", "  ", "ab", "x" * 501])
    def test_a_decision_without_a_usable_reason_is_refused(
        self,
        service: ContentReviewService,
        scanner: ForbiddenPhraseScanner,
        status: str,
        reason: str,
    ) -> None:
        queued = _enqueue(service, scanner, candidate=CLEAN_CANDIDATE)
        assert queued is not None

        with pytest.raises(ReviewDecisionError):
            service.decide(queued.item_id, status=status, reviewer_id="rev-1", reason=reason)

        # And the item is untouched: still awaiting a real decision.
        still = service.get(queued.item_id)
        assert still is not None and still.status == STATUS_PENDING

    def test_a_decision_without_a_reviewer_is_refused(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        queued = _enqueue(service, scanner, candidate=CLEAN_CANDIDATE)
        assert queued is not None

        with pytest.raises(ReviewDecisionError):
            service.decide(
                queued.item_id, status=STATUS_APPROVED, reviewer_id="   ", reason="fine by me"
            )

    def test_an_unknown_status_is_refused(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        queued = _enqueue(service, scanner, candidate=CLEAN_CANDIDATE)
        assert queued is not None

        with pytest.raises(ReviewDecisionError):
            service.decide(
                queued.item_id, status=STATUS_PENDING, reviewer_id="rev-1", reason="fine by me"
            )


class TestAnApprovalIsImmutable:
    def test_it_carries_the_reviewer_and_the_moment_it_was_decided(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        queued = _enqueue(service, scanner, candidate=CLEAN_CANDIDATE)
        assert queued is not None
        before = datetime.now().astimezone()

        decided = service.decide(
            queued.item_id,
            status=STATUS_APPROVED,
            reviewer_id="rev-1",
            reason="faithful to the approved wording",
        )

        assert decided.status == STATUS_APPROVED
        assert decided.reviewer_id == "rev-1"
        assert decided.reason == "faithful to the approved wording"
        assert decided.decided_at is not None
        assert decided.decided_at >= before.astimezone(decided.decided_at.tzinfo)

    def test_a_second_decision_cannot_overwrite_the_first(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        queued = _enqueue(service, scanner, candidate=CLEAN_CANDIDATE)
        assert queued is not None
        first = service.decide(
            queued.item_id,
            status=STATUS_APPROVED,
            reviewer_id="rev-1",
            reason="faithful to the approved wording",
        )

        # Someone else trying to flip it later must not be able to rewrite who
        # approved it, when, or why.
        with pytest.raises(ReviewDecisionError):
            service.decide(
                queued.item_id,
                status=STATUS_REJECTED,
                reviewer_id="rev-2",
                reason="changed my mind",
            )

        after = service.get(queued.item_id)
        assert after is not None
        assert after.status == STATUS_APPROVED
        assert after.reviewer_id == "rev-1"
        assert after.decided_at == first.decided_at
        assert after.reason == "faithful to the approved wording"

    def test_a_rejection_is_equally_final(
        self, service: ContentReviewService, scanner: ForbiddenPhraseScanner
    ) -> None:
        queued = _enqueue(service, scanner, candidate=CLEAN_CANDIDATE)
        assert queued is not None
        service.decide(
            queued.item_id,
            status=STATUS_REJECTED,
            reviewer_id="rev-1",
            reason="reads as a diagnosis",
        )

        with pytest.raises(ReviewDecisionError):
            service.decide(
                queued.item_id, status=STATUS_APPROVED, reviewer_id="rev-2", reason="on reflection"
            )
        assert service.approved_candidate("report-1") is None
