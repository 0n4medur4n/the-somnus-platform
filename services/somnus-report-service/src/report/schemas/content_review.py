"""Wire contract for the AI content review queue (Checkpoint 15.3).

Consumed by edge-api's `/admin/v1/content-review/*` routes, which are the only
caller (this service is private, §5.6). The mirror of these shapes lives in
`packages/api-contracts` as Zod, which is the source of truth for the TypeScript
side; these Pydantic models are the Python half of the same boundary.

`deterministicText` and `candidateText` both travel, because the reviewer's whole
job is to compare them (Addendum A §A4). Neither hash is redundant with them:
the hashes are what tie an approved item back to the exact generation §15 logged.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from report.schemas.base import ContractModel


class ProvenanceCitationDTO(ContractModel):
    source_id: str
    citation: str
    url: str
    resolved_by: str


class ProvenanceDocumentDTO(ContractModel):
    document_id: str
    title: str
    citation: str
    locale: str
    corpus_version_added: int | None
    retired_since: bool


class ReportProvenanceDTO(ContractModel):
    """What grounded the report this candidate paraphrases (§B5 Checkpoint 16.5).

    Present on a queue item only when the report recorded one. Absent rather than
    empty when it did not: a reviewer should be able to tell "nothing grounded
    this beyond the artifact" apart from "we did not record what did".
    """

    corpus_version: int
    content_version: str
    citations: list[ProvenanceCitationDTO]
    documents: list[ProvenanceDocumentDTO]


class ContentReviewItemDTO(ContractModel):
    item_id: str
    report_id: str
    prompt_template_version: str
    model_id: str
    input_hash: str
    output_hash: str
    deterministic_text: str
    candidate_text: str
    status: str
    # Null until decided; set together, and never rewritten afterwards.
    reviewer_id: str | None = None
    decided_at: datetime | None = None
    reason: str | None = None
    created_at: datetime
    # Checkpoint 16.5. Null when the report recorded no provenance.
    provenance: ReportProvenanceDTO | None = None


class ContentReviewQueueDTO(ContractModel):
    items: list[ContentReviewItemDTO]


class ContentReviewDecisionDTO(ContractModel):
    """A reviewer's decision. A reason is required in BOTH directions.

    Mirrors AdminVerificationDecisionRequestSchema from Checkpoint 15.2: an
    approval with no recorded reason is exactly what an audit needs to be able to
    question later, so it is not accepted either.
    """

    decision: Literal["approve", "reject"]
    reason: str = Field(min_length=3, max_length=500)
    reviewer_id: str = Field(min_length=1, max_length=64)
