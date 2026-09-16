"""Corpus provenance end to end, against MySQL (§B5 Checkpoint 16.5).

A report is generated, its provenance is stamped, and a reviewer sees it through
the real `/internal/v1/admin/content-review/items` route — the 15.3 queue, not a
new one. Both logical databases are involved: the record is written to
`somnus_reporting` and the documents it names are described from `somnus_content`.

Three properties get their only real proof here, because each of them lives in
storage rather than in Python:

* **Immutability.** One row per report, refused on a second write and refused
  again by the primary key underneath.
* **Retired-document resolution.** A document retired after a report was made
  still describes that report correctly, through 16.1's `documents_live_at`.
* **The empty-corpus case.** Every environment today: no published corpus, so a
  provenance record with corpus version 0, Index A's citation present, and
  supporting material absent rather than broken.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from report.application.content_review import ContentReviewService
from report.application.provenance import ProvenanceRecorder, ProvenanceResolver
from report.application.render_service import RenderService
from report.application.retrieval import CitationResolver
from report.corpus.models import (
    CorpusVersionRow,
    ReferenceDocumentChunkRow,
    ReferenceDocumentRow,
    ReferenceDocumentScopeRow,
)
from report.corpus.repository import CorpusRepository, DocumentScope
from report.infrastructure.forbidden import ForbiddenPhraseScanner
from report.infrastructure.models import (
    AiContentReviewItemRow,
    ReportCorpusProvenanceRow,
)
from report.infrastructure.storage import LocalStorageBackend
from report.main import create_app
from report.repositories.content_review_repository import ContentReviewRepositorySql
from report.repositories.provenance_repository import (
    ProvenanceImmutableError,
    ProvenanceRepository,
)
from report.schemas.provenance import CitationRecord, ProvenanceDocument
from report.schemas.render import ClinicalContentDTO
from report.schemas.retrieval import CorpusEntry, GroundingMaterial
from report.settings.config import Settings

ADMIN = "018f0000-0000-7000-8000-0000000000ad"
QUEUE = "/internal/v1/admin/content-review/items"

INDEX_A = [
    CorpusEntry(
        source_id="SRC-02",
        citation="Kapur VK. Diagnostic Testing for Adult OSA.",
        url="https://example.org/src-02",
        vector=[0.0, 1.0],
        cited_by_rules=("SAFE-006",),
    )
]

CITATION_TEXT = "Kapur VK. Diagnostic Testing for Adult OSA."
DOC_TITLE = "Higiene del sueño en adultos"


class _FakePdf:
    def to_pdf(self, html: str) -> bytes:
        return b"%PDF-1.7 fake"


class _FakeContent:
    def __init__(self, content: ClinicalContentDTO) -> None:
        self._content = content

    def get_content(self) -> ClinicalContentDTO:
        return self._content


class _StaticGrounding:
    """Index B's answer, fixed, so this suite is about provenance and not retrieval."""

    def __init__(self, materials: list[GroundingMaterial]) -> None:
        self._materials = materials

    def retrieve(self, request: object, queries: tuple = ()) -> list[GroundingMaterial]:
        return list(self._materials)


@pytest.fixture
def clean(db_session: Session, corpus_session: Session) -> Iterator[None]:
    for table in (ReportCorpusProvenanceRow, AiContentReviewItemRow):
        db_session.execute(delete(table))
    db_session.commit()
    for table in (
        ReferenceDocumentScopeRow,
        ReferenceDocumentChunkRow,
        ReferenceDocumentRow,
        CorpusVersionRow,
    ):
        corpus_session.query(table).delete()
    corpus_session.commit()
    yield


def _publish_document(corpus_session: Session, title: str = DOC_TITLE) -> tuple[str, int]:
    repo = CorpusRepository(corpus_session)
    document_id = repo.add_draft(
        title=title,
        citation=f"The Somnus (2026). {title}.",
        source_type="guideline",
        locale="es",
        added_by=ADMIN,
        scopes=(DocumentScope("module", "INS"),),
        rights_status="own_document",
    )
    repo.add_text(document_id, "Un párrafo aprobado.")
    version = repo.publish(document_id, by=ADMIN, changelog="Alta.")
    corpus_session.commit()
    return document_id, version


def _recorder(engine: Engine, corpus_engine: Engine) -> ProvenanceRecorder:
    reporting = sessionmaker(bind=engine, expire_on_commit=False)

    def corpus_version() -> int:
        with sessionmaker(bind=corpus_engine, expire_on_commit=False)() as session:
            return CorpusRepository(session).current_version()

    return ProvenanceRecorder(reporting, corpus_version)


def _resolver(corpus_engine: Engine) -> ProvenanceResolver:
    factory = sessionmaker(bind=corpus_engine, expire_on_commit=False)

    def live(corpus_version: int) -> dict[str, ProvenanceDocument]:
        with factory() as session:
            return {
                document.id: ProvenanceDocument(
                    document_id=document.id,
                    title=document.title,
                    citation=document.citation,
                    locale=document.locale,
                    corpus_version_added=document.corpus_version_added,
                    retired_since=document.corpus_version_retired is not None,
                )
                for document in CorpusRepository(session).documents_live_at(corpus_version)
            }

    return ProvenanceResolver(live)


def _service(
    tmp_path: Path,
    content: ClinicalContentDTO,
    engine: Engine,
    corpus_engine: Engine,
    materials: list[GroundingMaterial],
) -> RenderService:
    return RenderService(
        content_provider=_FakeContent(content),
        pdf_renderer=_FakePdf(),
        storage=LocalStorageBackend(root=tmp_path, base_url="http://x/reports"),
        signed_url_ttl=timedelta(minutes=15),
        citations=CitationResolver(lambda _v: list(INDEX_A)),
        grounding=_StaticGrounding(materials),
        provenance=_recorder(engine, corpus_engine),
    )


def _material(document_id: str) -> GroundingMaterial:
    return GroundingMaterial(
        document_id=document_id,
        title=DOC_TITLE,
        citation=f"The Somnus (2026). {DOC_TITLE}.",
        locale="es",
        corpus_version_added=1,
        matched_scope_type="module",
        matched_scope_key="INS",
        text="Un párrafo aprobado.",
        score=0.9,
    )


# --- recorded at generation, and immutable ----------------------------------


def test_generating_a_report_stamps_what_grounded_it(
    clean: None,
    tmp_path: Path,
    content: ClinicalContentDTO,
    engine: Engine,
    corpus_engine: Engine,
    corpus_session: Session,
    db_session: Session,
    make_request,
) -> None:
    document_id, version = _publish_document(corpus_session)

    ref = _service(tmp_path, content, engine, corpus_engine, [_material(document_id)]).render(
        make_request(
            level="L4", routes=("INS",), role="professional", triggered_rules=("SAFE-006",)
        )
    )

    record = ProvenanceRepository(db_session).get(ref.report_id)
    assert record is not None
    assert record.corpus_version == version
    assert record.content_version == "1.2"
    assert record.locale == "es"
    # Index A, stamped as rendered.
    assert [citation.source_id for citation in record.citations] == ["SRC-02"]
    assert record.citations[0].citation == CITATION_TEXT
    assert record.citations[0].resolved_by == "rule"
    # Index B: which documents were USED, not which existed.
    assert record.document_ids == (document_id,)


def test_a_provenance_record_cannot_be_rewritten(clean: None, db_session: Session) -> None:
    """Same discipline as every stamped-at-generation field (§17).

    Not "the second write wins" and not "the second write is merged": refused.
    """
    repository = ProvenanceRepository(db_session)
    repository.record(
        "report-immutable",
        corpus_version=3,
        content_version="1.2",
        locale="es",
        citations=[CitationRecord("SRC-02", CITATION_TEXT, "https://example.org", "rule")],
        document_ids=["d-1"],
    )
    db_session.commit()

    with pytest.raises(ProvenanceImmutableError, match="never rewritten"):
        repository.record(
            "report-immutable",
            corpus_version=99,
            content_version="9.9",
            locale="en",
            citations=[],
            document_ids=[],
        )
    db_session.rollback()

    after = repository.get("report-immutable")
    assert after is not None
    assert after.corpus_version == 3
    assert after.content_version == "1.2"
    assert after.document_ids == ("d-1",)


def test_only_one_row_per_report_exists_at_the_schema_level(
    clean: None, db_session: Session
) -> None:
    """The repository refuses; the primary key would refuse anyway."""
    ProvenanceRepository(db_session).record(
        "report-pk",
        corpus_version=1,
        content_version="1.2",
        locale="es",
        citations=[],
        document_ids=[],
    )
    db_session.commit()

    db_session.add(
        ReportCorpusProvenanceRow(
            report_id="report-pk",
            corpus_version=2,
            content_version="1.3",
            locale="en",
            citations="[]",
            document_ids="[]",
        )
    )
    # The database's own refusal, not the repository's: a duplicate primary key.
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    record = ProvenanceRepository(db_session).get("report-pk")
    assert record is not None
    assert record.corpus_version == 1


# --- the reviewer sees it, through the real 15.3 route ----------------------


@pytest.fixture
def client(engine: Engine, corpus_engine: Engine) -> Iterator[TestClient]:
    app = create_app(Settings(service_name="somnus-report-service", env="test"))
    app.state.session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    app.state.corpus_session_factory = sessionmaker(bind=corpus_engine, expire_on_commit=False)
    app.state.provenance_resolver = _resolver(corpus_engine)
    with TestClient(app) as test_client:
        yield test_client


def _enqueue(db_session: Session, report_id: str) -> str:
    """A pending review item for this report, through the 15.3 service."""
    service = ContentReviewService(ContentReviewRepositorySql(db_session))
    item = service.enqueue(
        report_id=report_id,
        deterministic_text="El resultado estructurado aprobado.",
        candidate_text="Tus respuestas sugieren revisar tus horarios de descanso.",
        scanner=ForbiddenPhraseScanner(forbidden_phrases=[], blocked_claims=[]),
        model_id="gpt-5.6",
        prompt_template_version="rewrite_v1",
        prompt_template_id="rewrite_plain_language",
    )
    db_session.commit()
    assert item is not None
    return item.item_id


def test_the_review_queue_shows_what_the_report_was_grounded_in(
    clean: None,
    tmp_path: Path,
    content: ClinicalContentDTO,
    engine: Engine,
    corpus_engine: Engine,
    corpus_session: Session,
    db_session: Session,
    client: TestClient,
    make_request,
) -> None:
    """The exit criterion: real route, real data, both databases."""
    document_id, version = _publish_document(corpus_session)
    ref = _service(tmp_path, content, engine, corpus_engine, [_material(document_id)]).render(
        make_request(
            level="L4", routes=("INS",), role="professional", triggered_rules=("SAFE-006",)
        )
    )
    _enqueue(db_session, ref.report_id)

    body = client.get(QUEUE).json()
    item = next(entry for entry in body["items"] if entry["reportId"] == ref.report_id)
    provenance = item["provenance"]

    assert provenance is not None
    assert provenance["corpusVersion"] == version
    assert provenance["contentVersion"] == "1.2"
    # Index A's citation, by text rather than by id.
    assert [citation["citation"] for citation in provenance["citations"]] == [CITATION_TEXT]
    assert provenance["citations"][0]["sourceId"] == "SRC-02"
    # Index B's document, by title rather than by id -- resolved from the corpus.
    assert [document["title"] for document in provenance["documents"]] == [DOC_TITLE]
    assert provenance["documents"][0]["documentId"] == document_id
    assert provenance["documents"][0]["retiredSince"] is False


def test_a_document_retired_after_generation_still_describes_the_older_report(
    clean: None,
    tmp_path: Path,
    content: ClinicalContentDTO,
    engine: Engine,
    corpus_engine: Engine,
    corpus_session: Session,
    db_session: Session,
    client: TestClient,
    make_request,
) -> None:
    """The direct test of `documents_live_at` being reused, not reimplemented.

    A title resolved against today's corpus would vanish here. Resolved against
    the corpus as it was at the report's version, it is still there — and the
    reviewer is told it has since been retired.
    """
    document_id, version = _publish_document(corpus_session)
    ref = _service(tmp_path, content, engine, corpus_engine, [_material(document_id)]).render(
        make_request(
            level="L4", routes=("INS",), role="professional", triggered_rules=("SAFE-006",)
        )
    )
    _enqueue(db_session, ref.report_id)

    CorpusRepository(corpus_session).retire(
        document_id, by=ADMIN, reason="Sustituida.", changelog="Retirada."
    )
    corpus_session.commit()

    body = client.get(QUEUE).json()
    item = next(entry for entry in body["items"] if entry["reportId"] == ref.report_id)
    documents = item["provenance"]["documents"]

    assert [document["title"] for document in documents] == [DOC_TITLE]
    assert documents[0]["retiredSince"] is True
    assert item["provenance"]["corpusVersion"] == version


def test_an_empty_corpus_gives_the_citation_and_no_supporting_material(
    clean: None,
    tmp_path: Path,
    content: ClinicalContentDTO,
    engine: Engine,
    corpus_engine: Engine,
    db_session: Session,
    client: TestClient,
    make_request,
) -> None:
    """Every environment today (16.4: no embedding key, nothing published).

    §B3.1's "costs richness, never correctness", one step further: the reviewer
    still sees the citation, and the supporting-material list is correctly empty
    rather than an error.
    """
    ref = _service(tmp_path, content, engine, corpus_engine, []).render(
        make_request(
            level="L4", routes=("INS",), role="professional", triggered_rules=("SAFE-006",)
        )
    )
    _enqueue(db_session, ref.report_id)

    body = client.get(QUEUE).json()
    item = next(entry for entry in body["items"] if entry["reportId"] == ref.report_id)
    provenance = item["provenance"]

    assert provenance["corpusVersion"] == 0
    assert [citation["citation"] for citation in provenance["citations"]] == [CITATION_TEXT]
    assert provenance["documents"] == []


def test_an_item_whose_report_recorded_nothing_carries_no_provenance(
    clean: None, db_session: Session, client: TestClient
) -> None:
    """Absent, not empty. A reviewer can tell the two apart."""
    _enqueue(db_session, "report-without-provenance")

    body = client.get(QUEUE).json()
    item = next(
        entry for entry in body["items"] if entry["reportId"] == "report-without-provenance"
    )
    assert item["provenance"] is None


def test_the_stamped_citation_survives_a_corpus_that_moved_on(
    clean: None,
    tmp_path: Path,
    content: ClinicalContentDTO,
    engine: Engine,
    corpus_engine: Engine,
    corpus_session: Session,
    db_session: Session,
    client: TestClient,
    make_request,
) -> None:
    """The citation is stamped; only the supporting material is resolved."""
    document_id, _ = _publish_document(corpus_session)
    ref = _service(tmp_path, content, engine, corpus_engine, [_material(document_id)]).render(
        make_request(
            level="L4", routes=("INS",), role="professional", triggered_rules=("SAFE-006",)
        )
    )
    _enqueue(db_session, ref.report_id)

    # The corpus moves on: another document is published, bumping the version.
    _publish_document(corpus_session, title="Otra guía")

    body = client.get(QUEUE).json()
    item = next(entry for entry in body["items"] if entry["reportId"] == ref.report_id)

    # Still this report's version, this report's citation, this report's document.
    assert [c["citation"] for c in item["provenance"]["citations"]] == [CITATION_TEXT]
    assert [d["documentId"] for d in item["provenance"]["documents"]] == [document_id]


def test_the_stored_record_is_json_and_holds_no_report_prose(
    clean: None, db_session: Session
) -> None:
    """Provenance is about sources, not about the person or the prose (§15).

    Nothing in this table carries candidate text, deterministic text, answers or
    anything else about the person the report is for.
    """
    ProvenanceRepository(db_session).record(
        "report-shape",
        corpus_version=2,
        content_version="1.2",
        locale="es",
        citations=[CitationRecord("SRC-02", CITATION_TEXT, "https://example.org", "rule")],
        document_ids=["d-1"],
    )
    db_session.commit()

    row = db_session.get(ReportCorpusProvenanceRow, "report-shape")
    assert row is not None
    assert json.loads(row.document_ids) == ["d-1"]
    assert json.loads(row.citations)[0]["sourceId"] == "SRC-02"
    columns = {column.name for column in ReportCorpusProvenanceRow.__table__.columns}
    assert columns == {
        "report_id",
        "corpus_version",
        "content_version",
        "locale",
        "citations",
        "document_ids",
        "created_at",
    }
    assert isinstance(row.created_at, datetime)
    assert row.created_at <= datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=5)
