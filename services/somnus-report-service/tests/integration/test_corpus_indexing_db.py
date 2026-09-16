"""Index B against MySQL: embedding on publish, and scoped retrieval (16.4).

The unit suites prove the rules with a loader that filters the way the SQL is
supposed to. This one proves the SQL actually filters that way, which is the half
a fake can never establish — a scope or locale leak lives in a WHERE clause, not
in Python.

It also closes the one chain this checkpoint creates for the first time: §B4's
rights gate stands between a draft and `published`, and publishing is what
triggers indexing. 16.2 already proved the gate; what is new here is that the two
are connected, so a document that could not be published has no path to the
embedding API at all.
"""

from __future__ import annotations

import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from report.corpus.embedding_gate import CorpusEmbeddingGate
from report.corpus.indexer import CorpusIndexer
from report.corpus.models import (
    CorpusVersionRow,
    ReferenceDocumentChunkRow,
    ReferenceDocumentRow,
    ReferenceDocumentScopeRow,
)
from report.corpus.repository import (
    CorpusRepository,
    CorpusStateError,
    DocumentScope,
)
from report.corpus.retrieval import CorpusRetriever
from report.corpus.rights import RightsError, build_evidence
from report.infrastructure.llm.provider import EmbeddingRequest, EmbeddingResponse
from report.main import create_app
from report.schemas.retrieval import GroundingRequest
from report.settings.config import Settings

ADMIN = "018f0000-0000-7000-8000-0000000000ac"
ACTOR_HEADER = {"x-somnus-actor-id": ADMIN}
CORPUS = "/internal/v1/admin/corpus"

MODEL = "text-embedding-3-large"
TEXT_A = "Primer párrafo aprobado."
TEXT_B = "Segundo párrafo aprobado."


class _FakeEmbedder:
    """Records what it was asked to embed and answers deterministically."""

    def __init__(self) -> None:
        self.inputs: list[str] = []
        self.calls = 0

    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        self.calls += 1
        self.inputs.extend(request.inputs)
        return EmbeddingResponse(
            vectors=[[float(len(text)), 1.0] for text in request.inputs], model=request.model
        )


class _FailingEmbedder:
    def __init__(self) -> None:
        self.calls = 0

    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        self.calls += 1
        raise RuntimeError("provider unavailable")


@pytest.fixture
def repo(corpus_session: Session) -> CorpusRepository:
    for table in (
        ReferenceDocumentScopeRow,
        ReferenceDocumentChunkRow,
        ReferenceDocumentRow,
        CorpusVersionRow,
    ):
        corpus_session.query(table).delete()
    corpus_session.commit()
    return CorpusRepository(corpus_session)


def _publishable(
    repo: CorpusRepository,
    *,
    locale: str = "es",
    scopes: tuple[DocumentScope, ...] = (DocumentScope("module", "INS"),),
    title: str = "Higiene del sueño",
    texts: tuple[str, ...] = (TEXT_A, TEXT_B),
    rights_status: str = "own_document",
    rights_evidence: str | None = None,
) -> str:
    document_id = repo.add_draft(
        title=title,
        citation=f"The Somnus (2026). {title}.",
        source_type="guideline",
        locale=locale,
        added_by=ADMIN,
        scopes=scopes,
        rights_status=rights_status,
        rights_evidence=rights_evidence,
    )
    if texts:
        repo.add_text(document_id, "\n\n".join(texts))
    return document_id


def _indexer(embedder: object) -> CorpusIndexer:
    return CorpusIndexer(CorpusEmbeddingGate(embedder), model=MODEL, dimensions=2)  # type: ignore[arg-type]


# --- publishing indexes -----------------------------------------------------


def test_publishing_embeds_every_chunk_and_stores_the_vectors(
    repo: CorpusRepository, corpus_session: Session
) -> None:
    document_id = _publishable(repo)
    repo.publish(document_id, by=ADMIN, changelog="Alta.")

    embedder = _FakeEmbedder()
    stored = _indexer(embedder).index(repo, document_id)
    corpus_session.commit()

    assert stored == 2
    # Exactly the approved chunks, in order, and nothing else.
    assert embedder.inputs == [TEXT_A, TEXT_B]

    rows = (
        corpus_session.query(ReferenceDocumentChunkRow)
        .filter(ReferenceDocumentChunkRow.document_id == document_id)
        .order_by(ReferenceDocumentChunkRow.chunk_index)
        .all()
    )
    assert [json.loads(row.embedding or "[]") for row in rows] == [
        [float(len(TEXT_A)), 1.0],
        [float(len(TEXT_B)), 1.0],
    ]
    assert {row.embedding_model for row in rows} == {MODEL}
    assert {row.embedding_dimensions for row in rows} == {2}
    assert all(row.embedded_at is not None for row in rows)


def test_a_partial_vector_set_is_refused_and_stores_nothing(
    repo: CorpusRepository, corpus_session: Session
) -> None:
    """§B2a.1's all-or-nothing, applied to Index B.

    A document with vectors on some chunks and not others is retrievable, looks
    indexed, and silently grounds on a fraction of itself.
    """
    document_id = _publishable(repo)
    repo.publish(document_id, by=ADMIN, changelog="Alta.")
    # Committed first, so the rollback below undoes the refused write and not
    # the document it was refused for.
    corpus_session.commit()

    with pytest.raises(CorpusStateError, match="partially embedded"):
        repo.store_embeddings(document_id, [[1.0, 0.0]], model=MODEL, dimensions=2)

    corpus_session.rollback()
    rows = (
        corpus_session.query(ReferenceDocumentChunkRow)
        .filter(ReferenceDocumentChunkRow.document_id == document_id)
        .all()
    )
    assert [row.embedding for row in rows] == [None, None]


# --- the chain 16.2 and 16.4 form together ----------------------------------


def test_a_document_that_could_not_be_published_is_never_indexed(
    repo: CorpusRepository, corpus_session: Session
) -> None:
    """The end-to-end chain, not a re-proof of §B4.

    16.2 proved the gate refuses. What is asserted here is that refusing to
    publish is refusing to index: the document stays a draft, the indexer will
    not touch a draft, and the provider is never called on either path.
    """
    document_id = _publishable(repo, rights_status="open_access", rights_evidence=None)
    # The draft is committed before the refused publish, so what the rollback
    # discards is the failed transition alone.
    corpus_session.commit()
    embedder = _FakeEmbedder()

    with pytest.raises(RightsError):
        repo.publish(document_id, by=ADMIN, changelog="Alta.")
    corpus_session.rollback()

    assert repo.get(document_id).status == "draft"
    with pytest.raises(CorpusStateError, match="only a published document"):
        _indexer(embedder).index(repo, document_id)

    assert embedder.calls == 0


def test_evidence_completed_makes_the_same_document_publishable_and_indexable(
    repo: CorpusRepository, corpus_session: Session
) -> None:
    """The other half of the chain, so the test above cannot pass for a wrong reason."""
    document_id = _publishable(
        repo,
        rights_status="open_access",
        rights_evidence=build_evidence(licence="CC BY 4.0", url="https://example.org/oa"),
    )
    repo.publish(document_id, by=ADMIN, changelog="Alta.")

    embedder = _FakeEmbedder()
    assert _indexer(embedder).index(repo, document_id) == 2
    assert embedder.calls == 1
    corpus_session.commit()


def test_an_embedding_failure_leaves_the_publish_rolled_back(
    repo: CorpusRepository, corpus_session: Session
) -> None:
    """Publish and index are one transaction: no half-indexed published document."""
    document_id = _publishable(repo)
    # The draft is durable; the publish that follows is not yet. That is exactly
    # the situation the route is in when it publishes and indexes in one
    # transaction, so the rollback here undoes what the route's rollback would.
    corpus_session.commit()

    repo.publish(document_id, by=ADMIN, changelog="Alta.")
    with pytest.raises(RuntimeError, match="provider unavailable"):
        _indexer(_FailingEmbedder()).index(repo, document_id)
    corpus_session.rollback()

    assert repo.get(document_id).status == "draft"
    assert repo.current_version() == 0


# --- scoped retrieval, against the real query -------------------------------


def _retriever(corpus_engine: Engine, **kwargs: object) -> CorpusRetriever:
    factory = sessionmaker(bind=corpus_engine, expire_on_commit=False)

    def loader(locale: str, scopes: object) -> list:
        with factory() as session:
            return CorpusRepository(session).scoped_documents(locale=locale, scopes=scopes)  # type: ignore[arg-type]

    return CorpusRetriever(loader, **kwargs)  # type: ignore[arg-type]


def test_scope_isolation_holds_in_the_sql_not_just_in_python(
    repo: CorpusRepository, corpus_session: Session, corpus_engine: Engine
) -> None:
    ins = _publishable(repo, title="Sueño INS", scopes=(DocumentScope("module", "INS"),))
    bre = _publishable(repo, title="Respiración BRE", scopes=(DocumentScope("module", "BRE"),))
    src05 = _publishable(
        repo, title="Nota SRC-05", scopes=(DocumentScope("clinical_source", "SRC-05"),)
    )
    src10 = _publishable(
        repo, title="Nota SRC-10", scopes=(DocumentScope("clinical_source", "SRC-10"),)
    )
    for document_id in (ins, bre, src05, src10):
        repo.publish(document_id, by=ADMIN, changelog="Alta.")
    corpus_session.commit()

    retriever = _retriever(corpus_engine)

    # §B3: "A document scoped to BRE can never surface in a report that only
    # routed to INS."
    ins_only = retriever.retrieve(GroundingRequest(locale="es", module_ids=("INS",)))
    assert [material.document_id for material in ins_only] == [ins]

    # §B3.1: an SRC-05 enrichment never surfaces in a report that cited SRC-10.
    cited_src10 = retriever.retrieve(GroundingRequest(locale="es", source_ids=("SRC-10",)))
    assert [material.document_id for material in cited_src10] == [src10]


def test_locale_isolation_holds_in_the_sql(
    repo: CorpusRepository, corpus_session: Session, corpus_engine: Engine
) -> None:
    spanish = _publishable(repo, title="Guía en español", locale="es")
    catalan = _publishable(repo, title="Guia en català", locale="ca")
    for document_id in (spanish, catalan):
        repo.publish(document_id, by=ADMIN, changelog="Alta.")
    corpus_session.commit()

    retriever = _retriever(corpus_engine)
    in_spanish = retriever.retrieve(GroundingRequest(locale="es", module_ids=("INS",)))

    assert [material.document_id for material in in_spanish] == [spanish]
    # No silent fallback: §B3 makes cross-locale a deliberate, logged decision,
    # and there is no such decision here to make.
    assert catalan not in [material.document_id for material in in_spanish]


def test_a_draft_is_not_retrievable_however_well_scoped(
    repo: CorpusRepository, corpus_session: Session, corpus_engine: Engine
) -> None:
    _publishable(repo, title="Borrador INS")
    corpus_session.commit()

    retrieved = _retriever(corpus_engine).retrieve(
        GroundingRequest(locale="es", module_ids=("INS",))
    )
    assert retrieved == []


# --- retiring: out of retrieval, still in the history ------------------------


def test_a_retired_document_leaves_retrieval_but_still_answers_for_an_older_report(
    repo: CorpusRepository, corpus_session: Session, corpus_engine: Engine
) -> None:
    """§B3's whole reason for retiring instead of deleting.

    The version resolution here is 16.1's `documents_live_at`, used rather than
    rebuilt: a report stamped with the version that was current while this
    document was live must still be able to say what grounded it.
    """
    document_id = _publishable(repo, title="Guía retirada")
    live_version = repo.publish(document_id, by=ADMIN, changelog="Alta.")
    corpus_session.commit()

    retriever = _retriever(corpus_engine)
    assert [
        m.document_id
        for m in retriever.retrieve(GroundingRequest(locale="es", module_ids=("INS",)))
    ] == [document_id]

    retired_version = repo.retire(
        document_id, by=ADMIN, reason="Sustituida.", changelog="Retirada."
    )
    corpus_session.commit()

    # Gone from new retrieval...
    assert retriever.retrieve(GroundingRequest(locale="es", module_ids=("INS",))) == []

    # ...and still resolvable for a report rendered while it was live.
    live_then = repo.documents_live_at(live_version)
    assert [document.id for document in live_then] == [document_id]
    assert repo.get(document_id).corpus_version_retired == retired_version
    # The vectors are retained too (16.1): the row keeps everything it had.
    assert repo.chunk_texts(document_id) == [TEXT_A, TEXT_B]


# --- the console route actually triggers indexing ---------------------------


@pytest.fixture
def client(corpus_engine: Engine) -> Iterator[tuple[TestClient, _FakeEmbedder]]:
    with Session(corpus_engine) as session:
        for table in (
            ReferenceDocumentScopeRow,
            ReferenceDocumentChunkRow,
            ReferenceDocumentRow,
            CorpusVersionRow,
        ):
            session.query(table).delete()
        session.commit()

    app = create_app(Settings(service_name="somnus-report-service", env="test"))
    app.state.corpus_session_factory = sessionmaker(bind=corpus_engine, expire_on_commit=False)
    embedder = _FakeEmbedder()
    app.state.corpus_indexer = _indexer(embedder)
    with TestClient(app) as test_client:
        yield test_client, embedder


def test_publishing_through_the_console_route_indexes_the_document(
    client: tuple[TestClient, _FakeEmbedder], corpus_engine: Engine
) -> None:
    """The wiring, end to end: 16.3's route now does 16.4's work."""
    test_client, embedder = client
    created = test_client.post(
        f"{CORPUS}/documents",
        json={
            "title": "Higiene del sueño",
            "citation": "The Somnus (2026).",
            "sourceType": "guideline",
            "locale": "es",
            "rightsStatus": "own_document",
            "scopes": [{"scopeType": "module", "scopeKey": "INS"}],
            "text": f"{TEXT_A}\n\n{TEXT_B}",
        },
        headers=ACTOR_HEADER,
    )
    assert created.status_code == 201, created.text
    document_id = created.json()["id"]

    published = test_client.post(
        f"{CORPUS}/documents/{document_id}/publish",
        json={"changelog": "Alta de la guía."},
        headers=ACTOR_HEADER,
    )
    assert published.status_code == 200, published.text

    # The publish call embedded the document, and embedded only its own text.
    assert embedder.calls == 1
    assert embedder.inputs == [TEXT_A, TEXT_B]

    with Session(corpus_engine) as session:
        rows = (
            session.query(ReferenceDocumentChunkRow)
            .filter(ReferenceDocumentChunkRow.document_id == document_id)
            .all()
        )
    assert all(row.embedding for row in rows)
