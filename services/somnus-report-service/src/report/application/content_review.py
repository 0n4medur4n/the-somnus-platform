"""The human review queue for AI-reworded text (Checkpoint 15.3, closes 11.2).

Build plan §15 requires that all AI-generated health-related text be reviewed by
a human before release. Checkpoint 11.2 produced the text and the status but no
consumer: nothing could approve or reject, so `AI_REWRITE_ENABLED` had to stay
off and `report.application.ai_rewrite` refused to serve anything. This module is
the missing consumer.

Two rules shape the whole design, and both are about what can NOT happen:

1. **A candidate the forbidden-phrase scanner blocks never becomes reviewable.**
   The scanner runs before persistence, not after, so a BLOQUEAR claim is never
   put in front of a reviewer to be approved by mistake. The blocked candidate is
   logged (§15: hashes, never raw health text) and dropped.
2. **Only an approved item is renderable.** `approved_candidate` is the only way
   text leaves this module, and it filters on the stored status rather than on
   anything the caller passes in. A rejected or still-pending item is not
   "renderable but gated" -- there is no code path that returns it.

`AI_REWRITE_ENABLED` remains off. This checkpoint builds the mechanism; turning
the flag on is a separate decision, after the clinical lead has used the queue.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from report.infrastructure.forbidden import ForbiddenPhraseScanner
from report.infrastructure.llm.audit import build_audit, log_generation

logger = logging.getLogger("report.content_review")

# `pending_review` is 11.2's vocabulary (report.application.rewriter, §15) and is
# kept verbatim rather than shortened, so one state does not end up with two names
# across the same service.
STATUS_PENDING = "pending_review"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"

DECISION_STATUSES = (STATUS_APPROVED, STATUS_REJECTED)

# Mirrors AdminVerificationDecisionRequestSchema (Checkpoint 15.2): a decision
# without a recorded reason is not accepted, in either direction.
REASON_MIN_LENGTH = 3
REASON_MAX_LENGTH = 500


class ReviewDecisionError(ValueError):
    """A decision was refused: bad status, missing reason, or already decided."""


@dataclass(frozen=True)
class ContentReviewItem:
    """One AI candidate awaiting, or having received, a human decision."""

    item_id: str
    report_id: str
    prompt_template_version: str
    model_id: str
    input_hash: str
    output_hash: str
    # The approved deterministic prose the candidate was reworded from. Stored
    # rather than re-derived so the reviewer sees exactly what the model saw, and
    # so the record stays meaningful after templates move on. §A4 requires the
    # side-by-side; a hash cannot be shown to a human.
    deterministic_text: str
    candidate_text: str
    status: str
    reviewer_id: str | None
    decided_at: datetime | None
    reason: str | None
    created_at: datetime

    @property
    def is_renderable(self) -> bool:
        return self.status == STATUS_APPROVED


class ContentReviewRepository(Protocol):
    """Persistence port. Implemented over `somnus_reporting` (§7: this service
    owns that database; nothing else reads or writes these rows)."""

    def add(self, item: ContentReviewItem) -> None: ...

    def get(self, item_id: str) -> ContentReviewItem | None: ...

    def list_by_status(self, status: str, *, limit: int) -> Sequence[ContentReviewItem]: ...

    def latest_approved_for_report(self, report_id: str) -> ContentReviewItem | None: ...

    def record_decision(
        self, item_id: str, *, status: str, reviewer_id: str, reason: str, decided_at: datetime
    ) -> ContentReviewItem | None: ...


class ContentReviewService:
    def __init__(self, repository: ContentReviewRepository) -> None:
        self._repository = repository

    def enqueue(
        self,
        *,
        report_id: str,
        deterministic_text: str,
        candidate_text: str,
        scanner: ForbiddenPhraseScanner,
        model_id: str,
        prompt_template_version: str,
        prompt_template_id: str,
    ) -> ContentReviewItem | None:
        """Queue a candidate for review, unless the scanner blocks it.

        The scan happens here, before anything is written, because a queued item
        is by definition something a reviewer may approve. A candidate carrying a
        BLOQUEAR claim must never be presented as an option -- the reviewer's job
        is judgement about wording, not catching what an automated guardrail
        already knows is prohibited.

        Returns the queued item, or None when the candidate was blocked.
        """
        blocked = scanner.scan(candidate_text)
        status = STATUS_REJECTED if blocked else STATUS_PENDING

        # §15 logging, on both paths: model, template version, prompt-template id,
        # input hash, response hash, timestamp, review status. Hashes only.
        log_generation(
            build_audit(
                model=model_id,
                template_version=prompt_template_version,
                prompt_template_id=prompt_template_id,
                structured_input=deterministic_text,
                response_text=candidate_text,
                review_status=status,
            )
        )

        if blocked:
            # Named phrases, not the text that matched them: the phrases are
            # governed content, the candidate is health prose.
            logger.warning(
                "AI candidate blocked before review; not queued",
                extra={
                    "contentReview": {
                        "reportId": report_id,
                        "blockedPhraseCount": len(blocked),
                        "blockedPhrases": blocked,
                        "reviewStatus": STATUS_REJECTED,
                    }
                },
            )
            return None

        audit = build_audit(
            model=model_id,
            template_version=prompt_template_version,
            prompt_template_id=prompt_template_id,
            structured_input=deterministic_text,
            response_text=candidate_text,
            review_status=status,
        )
        item = ContentReviewItem(
            item_id=uuid.uuid4().hex,
            report_id=report_id,
            prompt_template_version=prompt_template_version,
            model_id=model_id,
            input_hash=audit.input_hash,
            output_hash=audit.response_hash,
            deterministic_text=deterministic_text,
            candidate_text=candidate_text,
            status=STATUS_PENDING,
            reviewer_id=None,
            decided_at=None,
            reason=None,
            created_at=datetime.now(UTC),
        )
        self._repository.add(item)
        return item

    def pending(self, *, limit: int = 50) -> Sequence[ContentReviewItem]:
        """The reviewable queue. Only ever pending items, by construction."""
        return self._repository.list_by_status(STATUS_PENDING, limit=limit)

    def get(self, item_id: str) -> ContentReviewItem | None:
        return self._repository.get(item_id)

    def decide(
        self, item_id: str, *, status: str, reviewer_id: str, reason: str
    ) -> ContentReviewItem:
        """Approve or reject, recording who decided, when, and why.

        A decision is final: an already-decided item is not re-decided, so the
        reviewer identity and timestamp on an approved item cannot be overwritten
        later by someone else's decision.
        """
        if status not in DECISION_STATUSES:
            raise ReviewDecisionError(f"status must be one of {DECISION_STATUSES}, got {status!r}")
        cleaned = reason.strip()
        if len(cleaned) < REASON_MIN_LENGTH or len(cleaned) > REASON_MAX_LENGTH:
            raise ReviewDecisionError(
                "a decision requires a reason of "
                f"{REASON_MIN_LENGTH}-{REASON_MAX_LENGTH} characters, in both directions"
            )
        if not reviewer_id.strip():
            raise ReviewDecisionError("a decision requires the reviewer's identity")

        existing = self._repository.get(item_id)
        if existing is None:
            raise ReviewDecisionError(f"no review item {item_id!r}")
        if existing.status != STATUS_PENDING:
            raise ReviewDecisionError(
                f"review item {item_id!r} was already {existing.status}; decisions are final"
            )

        decided = self._repository.record_decision(
            item_id,
            status=status,
            reviewer_id=reviewer_id,
            reason=cleaned,
            decided_at=datetime.now(UTC),
        )
        if decided is None:
            raise ReviewDecisionError(f"no review item {item_id!r}")
        return decided

    def approved_candidate(self, report_id: str) -> str | None:
        """The only way AI text leaves this module.

        Filters on the persisted status, so a rejected or pending item has no code
        path out of here at all -- it is not returned-and-then-gated. Callers
        cannot ask for "the candidate regardless of status"; that function does
        not exist.
        """
        item = self._repository.latest_approved_for_report(report_id)
        if item is None or not item.is_renderable:
            return None
        return item.candidate_text
