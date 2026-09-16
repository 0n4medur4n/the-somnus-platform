"""Internal endpoints for the reference-corpus console (Addendum B §B3, 16.3).

Private service: edge-api is the only caller, so these live under `/internal/v1`
beside the other admin routes. **Authorization is not decided here.** Edge-api
names `admin_corpus_manage` on each route and identity answers whether the actor
holds it (build plan §5.3); §B6 item 4 restricts that capability to
`platform_super_admin` alone. This layer's job is different: it is where the
corpus's own rules are enforced, so that they hold no matter who is calling.

Three of those rules are visible in what this module does NOT contain:

* **No delete route.** §B3 allows append and retire, nothing else. Retire is the
  only terminal action, and it keeps the row — which is the only reason
  `documents_live_at` can still answer for an older `corpus_version`.
* **No second rights gate.** Publishing calls `CorpusRepository.publish`, which
  calls `require_publishable` (§B4). This module does not re-check rights, so
  there is exactly one definition of publishable and no way for a console path to
  drift from the embedding path.
* **No write path to an SRC's artifact fields.** `GET /sources` reads identifier,
  citation, `use` and citing rules straight from Morpheo's clinical artifact and
  returns them; no request shape this router accepts carries any of them, so an
  enrichment can only ever be a separate, `clinical_source`-scoped document
  (§B3.1).

Refusals are reported the way `content_review` reports them — 404 for an unknown
document, 409 for a document whose state or rights refuse the transition — so the
two admin surfaces behave alike for the console.
"""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request, status

from report.corpus.repository import (
    CorpusRepository,
    CorpusStateError,
    DocumentScope,
    ReferenceDocument,
)
from report.corpus.rights import RightsError, build_evidence, parse_evidence
from report.schemas.corpus import (
    CorpusDocumentCreateRequestDTO,
    CorpusDocumentDetailDTO,
    CorpusDocumentDTO,
    CorpusDocumentEditRequestDTO,
    CorpusDocumentPageDTO,
    CorpusPublishRequestDTO,
    CorpusRetireRequestDTO,
    CorpusRightsEvidenceDTO,
    CorpusScopeDTO,
    CorpusSearchRequestDTO,
    CorpusVersionResultDTO,
    SrcArtifactFieldsDTO,
    SrcEnrichmentPageDTO,
    SrcEnrichmentViewDTO,
)

router = APIRouter(prefix="/internal/v1/admin/corpus", tags=["corpus"])

ACTOR_ID_HEADER = "x-somnus-actor-id"

#: How many documents an unfiltered console list returns.
_DEFAULT_SEARCH_LIMIT = 50


def _actor(actor_id: str | None) -> str:
    """The acting admin, as edge-api resolved them from the session.

    Refused rather than defaulted: a corpus change attributed to nobody is worse
    than a corpus change that did not happen, because §B3's history is the record
    of who decided what belongs in the corpus.
    """
    if not actor_id or not actor_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{ACTOR_ID_HEADER} is required; corpus changes are always attributed",
        )
    return actor_id.strip()


def _evidence_dto(raw: str | None) -> CorpusRightsEvidenceDTO:
    stored = parse_evidence(raw)
    return CorpusRightsEvidenceDTO(
        licence=stored.get("licence") or None,
        url=stored.get("url") or None,
        holder=stored.get("holder") or None,
    )


def _evidence_json(evidence: CorpusRightsEvidenceDTO | None) -> str | None:
    if evidence is None:
        return None
    return build_evidence(
        licence=evidence.licence or "",
        url=evidence.url or "",
        holder=evidence.holder or "",
    )


def _to_dto(document: ReferenceDocument) -> CorpusDocumentDTO:
    return CorpusDocumentDTO(
        id=document.id,
        title=document.title,
        citation=document.citation,
        source_type=document.source_type,
        locale=document.locale,
        status=document.status,
        rights_status=document.rights_status,
        rights_evidence=_evidence_dto(document.rights_evidence),
        added_by=document.added_by,
        corpus_version_added=document.corpus_version_added,
        corpus_version_retired=document.corpus_version_retired,
        retired_reason=document.retired_reason,
        scopes=[
            CorpusScopeDTO(scope_type=scope.scope_type, scope_key=scope.scope_key)
            for scope in document.scopes
        ],
        chunk_count=document.chunk_count,
    )


def _scopes(scopes: list[CorpusScopeDTO]) -> list[DocumentScope]:
    return [DocumentScope(scope.scope_type, scope.scope_key) for scope in scopes]


def _refuse(error: Exception) -> HTTPException:
    """404 when the document is unknown, 409 when its state or rights refuse.

    A rights refusal is a 409 and not a 400: the request was well formed, and what
    turned it down is the document's own declared state (§B4).
    """
    message = str(error)
    if isinstance(error, CorpusStateError) and message.startswith("no reference document"):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)


@router.post(
    "/documents/search",
    response_model=CorpusDocumentPageDTO,
    summary="List and search reference documents, including retired ones.",
)
def search_documents(body: CorpusSearchRequestDTO, request: Request) -> CorpusDocumentPageDTO:
    """A POST because the filters are a body, not because it writes anything."""
    with request.app.state.corpus_session_factory() as session:
        repository = CorpusRepository(session)
        documents = repository.search(
            query=body.query,
            status=body.status,
            locale=body.locale,
            scope_type=body.scope_type,
            scope_key=body.scope_key,
            limit=body.limit or _DEFAULT_SEARCH_LIMIT,
        )
        return CorpusDocumentPageDTO(
            documents=[_to_dto(document) for document in documents],
            current_version=repository.current_version(),
        )


@router.get(
    "/documents/{document_id}",
    response_model=CorpusDocumentDetailDTO,
    summary="One reference document with its stored text, in any status.",
)
def get_document(document_id: str, request: Request) -> CorpusDocumentDetailDTO:
    """The text comes back here and nowhere else.

    An edit screen replaces a draft's text wholesale, so it has to be able to show
    what it is replacing; a list of every document's full text would be a large
    payload for screens that never use it.
    """
    with request.app.state.corpus_session_factory() as session:
        repository = CorpusRepository(session)
        try:
            document = repository.get(document_id)
        except CorpusStateError as error:
            raise _refuse(error) from error
        return CorpusDocumentDetailDTO(
            document=_to_dto(document), chunks=repository.chunk_texts(document_id)
        )


@router.post(
    "/documents",
    response_model=CorpusDocumentDTO,
    status_code=status.HTTP_201_CREATED,
    summary="Create a draft. A draft belongs to no corpus version yet.",
)
def create_document(
    body: CorpusDocumentCreateRequestDTO,
    request: Request,
    x_somnus_actor_id: str | None = Header(default=None),
) -> CorpusDocumentDTO:
    actor = _actor(x_somnus_actor_id)
    with request.app.state.corpus_session_factory() as session:
        repository = CorpusRepository(session)
        try:
            document_id = repository.add_draft(
                title=body.title,
                citation=body.citation,
                source_type=body.source_type,
                locale=body.locale,
                added_by=actor,
                scopes=_scopes(body.scopes),
                rights_status=body.rights_status,
                rights_evidence=_evidence_json(body.rights_evidence),
            )
            if body.text is not None:
                # §B4's cap is enforced in here. Nothing is committed until both
                # steps succeed, so text over the cap leaves no half-made draft.
                repository.add_text(document_id, body.text)
            document = repository.get(document_id)
        except (CorpusStateError, RightsError) as error:
            raise _refuse(error) from error
        session.commit()
        return _to_dto(document)


@router.post(
    "/documents/{document_id}/edit",
    response_model=CorpusDocumentDTO,
    summary="Edit a draft. A published document is retired and replaced, never edited.",
)
def edit_document(
    document_id: str,
    body: CorpusDocumentEditRequestDTO,
    request: Request,
    x_somnus_actor_id: str | None = Header(default=None),
) -> CorpusDocumentDTO:
    _actor(x_somnus_actor_id)
    with request.app.state.corpus_session_factory() as session:
        repository = CorpusRepository(session)
        try:
            repository.edit_draft(
                document_id,
                title=body.title,
                citation=body.citation,
                source_type=body.source_type,
                locale=body.locale,
                rights_status=body.rights_status,
                rights_evidence=_evidence_json(body.rights_evidence),
                scopes=_scopes(body.scopes) if body.scopes is not None else None,
                text=body.text,
            )
            document = repository.get(document_id)
        except (CorpusStateError, RightsError) as error:
            raise _refuse(error) from error
        session.commit()
        return _to_dto(document)


@router.post(
    "/documents/{document_id}/publish",
    response_model=CorpusVersionResultDTO,
    summary="Publish a draft, through §B4's rights gate, bumping the corpus version.",
)
def publish_document(
    document_id: str,
    body: CorpusPublishRequestDTO,
    request: Request,
    x_somnus_actor_id: str | None = Header(default=None),
) -> CorpusVersionResultDTO:
    actor = _actor(x_somnus_actor_id)
    with request.app.state.corpus_session_factory() as session:
        repository = CorpusRepository(session)
        try:
            # The gate lives inside this call (§B4). There is no second check
            # here, on purpose: one rule, one place, used by publish and by the
            # embedding boundary alike.
            version = repository.publish(document_id, by=actor, changelog=body.changelog)
            # Checkpoint 16.4: publishing is what triggers indexing, and this is
            # the only place the two are connected. It runs inside the same
            # transaction, so a provider failure rolls the publish back and
            # leaves a draft -- never a published document that is silently
            # absent from retrieval (§B2a.1's all-or-nothing, applied to Index B).
            #
            # `None` when no embedding key is configured. Publishing still
            # publishes; the document carries no vectors and §B3.1 already says
            # what that costs: richness of an explanation, never a citation.
            indexer = getattr(request.app.state, "corpus_indexer", None)
            if indexer is not None:
                indexer.index(repository, document_id)
        except (CorpusStateError, RightsError) as error:
            raise _refuse(error) from error
        session.commit()
        return CorpusVersionResultDTO(
            document_id=document_id, status="published", corpus_version=version
        )


@router.post(
    "/documents/{document_id}/retire",
    response_model=CorpusVersionResultDTO,
    summary="Retire a published document. The only terminal action there is.",
)
def retire_document(
    document_id: str,
    body: CorpusRetireRequestDTO,
    request: Request,
    x_somnus_actor_id: str | None = Header(default=None),
) -> CorpusVersionResultDTO:
    actor = _actor(x_somnus_actor_id)
    with request.app.state.corpus_session_factory() as session:
        repository = CorpusRepository(session)
        try:
            version = repository.retire(
                document_id, by=actor, reason=body.reason, changelog=body.changelog
            )
        except CorpusStateError as error:
            raise _refuse(error) from error
        session.commit()
        return CorpusVersionResultDTO(
            document_id=document_id, status="retired", corpus_version=version
        )


@router.get(
    "/sources",
    response_model=SrcEnrichmentPageDTO,
    summary="The fifteen clinical sources, with their console-added enrichments.",
)
def list_sources(request: Request) -> SrcEnrichmentPageDTO:
    """§B3.1: the artifact's fields, read-only, beside what the console may add.

    The artifact fields are fetched from Morpheo, which owns them (§B1), rather
    than mirrored into `somnus_content` — a mirror is a copy that can be written,
    and the point of this screen is that these fields cannot be.
    """
    artifact = request.app.state.corpus_sources_provider.get_sources()
    with request.app.state.corpus_session_factory() as session:
        repository = CorpusRepository(session)
        views = [
            SrcEnrichmentViewDTO(
                artifact=SrcArtifactFieldsDTO(
                    id=source.id,
                    citation=source.citation,
                    url=source.url,
                    use=source.use,
                    cited_by_rules=list(source.cited_by_rules),
                ),
                content_version=artifact.content_version,
                enrichments=[
                    _to_dto(document)
                    for document in repository.search(
                        scope_type="clinical_source", scope_key=source.id, limit=200
                    )
                ],
            )
            for source in artifact.sources
        ]
    return SrcEnrichmentPageDTO(sources=views)
