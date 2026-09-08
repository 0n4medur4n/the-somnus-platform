"""Internal endpoints for the AI content review queue (Checkpoint 15.3).

Private service: edge-api is the only caller, so these live under `/internal/v1`
like the render endpoint. **Authorization is not decided here.** Edge-api holds
the `admin_content_review` capability guard and identity owns the decision
(build plan §5.3: edge-api duplicates no authorization logic, and neither does
this service invent any). What this layer guarantees instead is the two rules the
queue exists for: a blocked candidate is never listed, and only an approved item
is ever renderable.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status

from report.application.content_review import (
    STATUS_APPROVED,
    STATUS_REJECTED,
    ContentReviewItem,
    ContentReviewService,
    ReviewDecisionError,
)
from report.repositories.content_review_repository import ContentReviewRepositorySql
from report.schemas.content_review import (
    ContentReviewDecisionDTO,
    ContentReviewItemDTO,
    ContentReviewQueueDTO,
)

router = APIRouter(prefix="/internal/v1/admin/content-review", tags=["content-review"])


def _to_dto(item: ContentReviewItem) -> ContentReviewItemDTO:
    return ContentReviewItemDTO(
        item_id=item.item_id,
        report_id=item.report_id,
        prompt_template_version=item.prompt_template_version,
        model_id=item.model_id,
        input_hash=item.input_hash,
        output_hash=item.output_hash,
        deterministic_text=item.deterministic_text,
        candidate_text=item.candidate_text,
        status=item.status,
        reviewer_id=item.reviewer_id,
        decided_at=item.decided_at,
        reason=item.reason,
        created_at=item.created_at,
    )


@router.get(
    "/items",
    response_model=ContentReviewQueueDTO,
    summary="The pending AI content review queue.",
)
def list_queue(request: Request, limit: int = 50) -> ContentReviewQueueDTO:
    """Only `pending_review` items. Decided ones are not a queue."""
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        service = ContentReviewService(ContentReviewRepositorySql(session))
        return ContentReviewQueueDTO(items=[_to_dto(item) for item in service.pending(limit=limit)])


@router.post(
    "/items/{item_id}/decision",
    response_model=ContentReviewItemDTO,
    summary="Approve or reject a candidate, with a reason.",
)
def decide(item_id: str, body: ContentReviewDecisionDTO, request: Request) -> ContentReviewItemDTO:
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        service = ContentReviewService(ContentReviewRepositorySql(session))
        try:
            decided = service.decide(
                item_id,
                status=STATUS_APPROVED if body.decision == "approve" else STATUS_REJECTED,
                reviewer_id=body.reviewer_id,
                reason=body.reason,
            )
        except ReviewDecisionError as error:
            # 409 rather than 400 for "already decided": the request was
            # well-formed, the item's state is what refused it.
            code = (
                status.HTTP_409_CONFLICT if "already" in str(error) else status.HTTP_400_BAD_REQUEST
            )
            raise HTTPException(status_code=code, detail=str(error)) from error
        session.commit()
        return _to_dto(decided)
