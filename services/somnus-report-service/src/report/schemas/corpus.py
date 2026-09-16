"""Wire contract for reference-corpus management (Addendum B §B3 / §B3.1, 16.3).

Consumed by edge-api's `/admin/v1/corpus/*` routes, the only caller (this service
is private, §5.6). The mirror lives in `packages/api-contracts` as Zod, which is
the source of truth for the TypeScript side.

The request shapes here carry no SRC identifier, citation, `use` or citing rules,
and that absence is the §B3.1 guarantee rather than a UI convention: those fields
are owned by `morpheo_workflows_v1.json`, the deterministic engine stamps them on
a result, and there is nothing in any request this service accepts that could
write them. `SrcArtifactFieldsDTO` is a response shape only.

There is likewise no delete request, because §B3 has no delete: retire is the only
terminal action, and a corpus the console could destroy would make every older
report's `corpus_version` unexplainable.
"""

from __future__ import annotations

from typing import Literal

from report.schemas.base import ContractModel

CorpusDocumentStatus = Literal["draft", "published", "retired"]
CorpusRightsStatus = Literal["own_document", "open_access", "licensed", "citation_only"]
CorpusScopeType = Literal["module", "safety_rule", "clinical_source", "general"]


class CorpusScopeDTO(ContractModel):
    scope_type: CorpusScopeType
    scope_key: str = ""


class CorpusRightsEvidenceDTO(ContractModel):
    licence: str | None = None
    url: str | None = None
    holder: str | None = None


class CorpusDocumentDTO(ContractModel):
    id: str
    title: str
    citation: str
    source_type: str
    locale: str
    status: CorpusDocumentStatus
    rights_status: CorpusRightsStatus | None
    rights_evidence: CorpusRightsEvidenceDTO
    added_by: str
    corpus_version_added: int | None
    corpus_version_retired: int | None
    retired_reason: str | None
    scopes: list[CorpusScopeDTO]
    chunk_count: int


class CorpusDocumentDetailDTO(ContractModel):
    """One document plus the text it holds. A single-document read only."""

    document: CorpusDocumentDTO
    chunks: list[str]


class CorpusDocumentPageDTO(ContractModel):
    documents: list[CorpusDocumentDTO]
    current_version: int


class CorpusDocumentCreateRequestDTO(ContractModel):
    title: str
    citation: str
    source_type: str
    locale: str
    scopes: list[CorpusScopeDTO]
    rights_status: CorpusRightsStatus | None = None
    rights_evidence: CorpusRightsEvidenceDTO | None = None
    text: str | None = None


class CorpusDocumentEditRequestDTO(ContractModel):
    title: str | None = None
    citation: str | None = None
    source_type: str | None = None
    locale: str | None = None
    scopes: list[CorpusScopeDTO] | None = None
    rights_status: CorpusRightsStatus | None = None
    rights_evidence: CorpusRightsEvidenceDTO | None = None
    text: str | None = None


class CorpusPublishRequestDTO(ContractModel):
    changelog: str


class CorpusRetireRequestDTO(ContractModel):
    reason: str
    changelog: str


class CorpusVersionResultDTO(ContractModel):
    document_id: str
    status: CorpusDocumentStatus
    corpus_version: int


class CorpusSearchRequestDTO(ContractModel):
    query: str | None = None
    status: CorpusDocumentStatus | None = None
    locale: str | None = None
    scope_type: CorpusScopeType | None = None
    scope_key: str | None = None
    limit: int | None = None


class SrcArtifactFieldsDTO(ContractModel):
    """What the clinical artifact owns. A RESPONSE shape, and never a request one."""

    id: str
    citation: str
    url: str
    use: str
    cited_by_rules: list[str]


class SrcEnrichmentViewDTO(ContractModel):
    artifact: SrcArtifactFieldsDTO
    content_version: str
    enrichments: list[CorpusDocumentDTO]


class SrcEnrichmentPageDTO(ContractModel):
    sources: list[SrcEnrichmentViewDTO]
