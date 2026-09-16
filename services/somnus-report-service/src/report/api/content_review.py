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
from report.repositories.provenance_repository import ProvenanceRepository
from report.schemas.content_review import (
    ContentReviewDecisionDTO,
    ContentReviewItemDTO,
    ContentReviewQueueDTO,
    ProvenanceCitationDTO,
    ProvenanceDocumentDTO,
    ReportProvenanceDTO,
)
from report.schemas.provenance import ResolvedProvenance

router = APIRouter(prefix="/internal/v1/admin/content-review", tags=["content-review"])


def _provenance_dto(resolved: ResolvedProvenance) -> ReportProvenanceDTO:
    return ReportProvenanceDTO(
        corpus_version=resolved.corpus_version,
        content_version=resolved.content_version,
        citations=[
            ProvenanceCitationDTO(
                source_id=citation.source_id,
                citation=citation.citation,
                url=citation.url,
                resolved_by=citation.resolved_by,
            )
            for citation in resolved.citations
        ],
        documents=[
            ProvenanceDocumentDTO(
                document_id=document.document_id,
                title=document.title,
                citation=document.citation,
                locale=document.locale,
                corpus_version_added=document.corpus_version_added,
                retired_since=document.retired_since,
            )
            for document in resolved.documents
        ],
    )


def _to_dto(
    item: ContentReviewItem, provenance: ReportProvenanceDTO | None = None
) -> ContentReviewItemDTO:
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
        provenance=provenance,
    )


@router.get(
    "/items",
    response_model=ContentReviewQueueDTO,
    summary="The pending AI content review queue.",
)
def list_queue(request: Request, limit: int = 50) -> ContentReviewQueueDTO:
    """Only `pending_review` items. Decided ones are not a queue.

    Each item carries the corpus provenance of the report its candidate
    paraphrases (Addendum B §B5 Checkpoint 16.5), so a reviewer judging wording
    can see what the deterministic result was grounded in rather than having to
    take the candidate's word for it.

    Provenance never fails the queue. It is read in one query for the whole page,
    resolved through the corpus module, and any item without a record — or a
    corpus that cannot be reached at all — simply carries none. A reviewer with
    less context can still do the job; a reviewer staring at an error screen
    cannot.
    """
    session_factory = request.app.state.session_factory
    resolver = getattr(request.app.state, "provenance_resolver", None)
    with session_factory() as session:
        service = ContentReviewService(ContentReviewRepositorySql(session))
        items = service.pending(limit=limit)
        records = ProvenanceRepository(session).get_many([item.report_id for item in items])

    provenance: dict[str, ReportProvenanceDTO] = {}
    if resolver is not None:
        for report_id, record in records.items():
            provenance[report_id] = _provenance_dto(resolver.resolve(record))

    return ContentReviewQueueDTO(
        items=[_to_dto(item, provenance.get(item.report_id)) for item in items]
    )


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
