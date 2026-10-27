"""The corpus upload job, through the console's own routes on the real schema (2026-10-27).

The job adds no path into the corpus of its own: it drives create -> upload ->
publish, so what these tests prove is that those routes, with the owner's rights
declaration, leave every document published, byte-identical to its original and
fully embedded -- and that the job says so when they do not.
"""

from __future__ import annotations

import io
from collections.abc import Iterator
from pathlib import Path

import pytest
from docx import Document
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from report.corpus.embedding_gate import CorpusEmbeddingGate
from report.corpus.file_store import LocalCorpusFileStore
from report.corpus.indexer import CorpusIndexer
from report.corpus.models import (
    CorpusVersionRow,
    ReferenceDocumentChunkRow,
    ReferenceDocumentOriginRow,
    ReferenceDocumentRow,
    ReferenceDocumentScopeRow,
)
from report.infrastructure.llm.provider import EmbeddingRequest, EmbeddingResponse
from report.jobs.upload_corpus import ENTRIES, Entry, make_reader, run_upload
from report.main import create_app
from report.settings.config import Settings

MODEL = "text-embedding-3-large"
DIMENSIONS = 2


class _Embedder:
    def __init__(self) -> None:
        self.calls = 0

    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        self.calls += 1
        return EmbeddingResponse(
            vectors=[[float(len(text)), 1.0] for text in request.inputs], model=request.model
        )


def _clean(engine: Engine) -> None:
    with Session(engine) as session:
        for table in (
            ReferenceDocumentOriginRow,
            ReferenceDocumentScopeRow,
            ReferenceDocumentChunkRow,
            ReferenceDocumentRow,
            CorpusVersionRow,
        ):
            session.query(table).delete()
        session.commit()


def _docx(*paragraphs: str) -> bytes:
    document = Document()
    for paragraph in paragraphs:
        document.add_paragraph(paragraph)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


@pytest.fixture
def embedder() -> _Embedder:
    return _Embedder()


@pytest.fixture
def client(corpus_engine: Engine, tmp_path: Path, embedder: _Embedder) -> Iterator[TestClient]:
    _clean(corpus_engine)
    app = create_app(Settings(service_name="somnus-report-service", env="test"))
    app.state.corpus_session_factory = sessionmaker(bind=corpus_engine, expire_on_commit=False)
    app.state.corpus_file_store = LocalCorpusFileStore(tmp_path / "originals")
    app.state.corpus_indexer = CorpusIndexer(
        CorpusEmbeddingGate(embedder),  # type: ignore[arg-type]
        model=MODEL,
        dimensions=DIMENSIONS,
    )
    with TestClient(app) as test_client:
        yield test_client
    _clean(corpus_engine)


@pytest.fixture
def pdfs(tmp_path: Path) -> Path:
    folder = tmp_path / "staging"
    folder.mkdir()
    (folder / "a.pdf").write_bytes(_docx("Primera guía.", "Texto uno de la guía."))
    (folder / "b.pdf").write_bytes(_docx("Segunda guía.", "Texto dos de la guía."))
    return folder


ENTRIES_UNDER_TEST = (
    Entry("a.pdf", "SRC-01", "Guía A", "Autor A. 2023.", "en"),
    Entry("b.pdf", "SRC-02", "Guía B", "Autor B. 2024.", "es"),
)


def _run(client: TestClient, corpus_engine: Engine, folder: Path, entries=ENTRIES_UNDER_TEST):
    return run_upload(
        client,
        sessionmaker(bind=corpus_engine, expire_on_commit=False),
        make_reader(str(folder)),
        entries,
        model=MODEL,
        dimensions=DIMENSIONS,
    )


def test_every_document_ends_published_identical_and_fully_embedded(
    client: TestClient, corpus_engine: Engine, pdfs: Path, embedder: _Embedder
) -> None:
    results = _run(client, corpus_engine, pdfs)
    assert [r["ok"] for r in results] == [True, True], results
    for result in results:
        assert result["action"] == "uploaded"
        assert result["chunks"] >= 1 and result["chunks"] == result["embedded"]
        assert all(result["checks"].values())
    with Session(corpus_engine) as session:
        rows = session.query(ReferenceDocumentRow).all()
        assert {row.rights_status for row in rows} == {"owner_authorised"}
        assert {row.status for row in rows} == {"published"}
        scopes = {(s.scope_type, s.scope_key) for s in session.query(ReferenceDocumentScopeRow)}
        assert scopes == {("clinical_source", "SRC-01"), ("clinical_source", "SRC-02")}
    assert embedder.calls == 2


def test_a_second_run_verifies_and_does_not_upload_or_embed_again(
    client: TestClient, corpus_engine: Engine, pdfs: Path, embedder: _Embedder
) -> None:
    _run(client, corpus_engine, pdfs)
    calls = embedder.calls
    again = _run(client, corpus_engine, pdfs)
    assert [r["action"] for r in again] == ["already published"] * 2
    assert all(r["ok"] for r in again)
    assert embedder.calls == calls
    with Session(corpus_engine) as session:
        assert session.query(ReferenceDocumentRow).count() == 2


def test_a_missing_file_is_reported_and_does_not_stop_the_others(
    client: TestClient, corpus_engine: Engine, pdfs: Path
) -> None:
    (pdfs / "a.pdf").unlink()
    results = _run(client, corpus_engine, pdfs)
    assert results[0]["ok"] is False and "error" in results[0]
    assert results[1]["ok"] is True


def test_missing_vectors_make_the_verification_fail(
    client: TestClient, corpus_engine: Engine, pdfs: Path
) -> None:
    """A document published without vectors (no key) must not pass as uploaded."""
    client.app.state.corpus_indexer = None  # type: ignore[attr-defined]
    results = _run(client, corpus_engine, pdfs)
    assert [r["ok"] for r in results] == [False, False]
    assert results[0]["checks"]["all_chunks_embedded"] is False


def test_the_entries_name_each_source_once_and_use_only_registry_ids() -> None:
    import json

    registry = json.loads(
        (
            Path(__file__).resolve().parents[4]
            / "services"
            / "morpheo-service"
            / "clinical"
            / "morpheo_workflows_v1.json"
        ).read_text(encoding="utf-8")
    )
    known = {source["id"] for source in registry["sources"]}
    srcs = [entry.src for entry in ENTRIES]
    assert len(srcs) == len(set(srcs)) and set(srcs) <= known
    assert len({entry.file for entry in ENTRIES}) == len(ENTRIES)


def test_a_gcs_source_is_split_into_bucket_and_prefix() -> None:
    from report.jobs import upload_corpus

    seen: list[tuple[str, str]] = []
    original = upload_corpus._gcs_reader
    upload_corpus._gcs_reader = lambda bucket, prefix: (
        seen.append((bucket, prefix))
        or (  # type: ignore[assignment]
            lambda name: b""
        )
    )
    try:
        make_reader("gs://my-bucket/staging/corpus")
    finally:
        upload_corpus._gcs_reader = original  # type: ignore[assignment]
    assert seen == [("my-bucket", "staging/corpus")]
