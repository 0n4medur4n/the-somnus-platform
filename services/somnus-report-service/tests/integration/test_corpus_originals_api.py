"""Uploaded originals and fetched pages, through the real routes (2026-10-18).

Owner decision (Addendum B §B6 item 3): a draft's text can come from a PDF or
Word upload -- kept and downloadable -- or from one web page. What must stay
true is everything §B3/§B4 already said: only a draft takes a new text, the
§B4 cap still applies, and publishing still goes through the rights gate.
"""

from __future__ import annotations

import base64
import io
from collections.abc import Iterator
from pathlib import Path

import pytest
from docx import Document
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from report.corpus.file_store import LocalCorpusFileStore
from report.corpus.models import (
    CorpusVersionRow,
    ReferenceDocumentChunkRow,
    ReferenceDocumentOriginRow,
    ReferenceDocumentRow,
    ReferenceDocumentScopeRow,
)
from report.corpus.web_page import FetchedPage, WebPageError
from report.main import create_app
from report.settings.config import Settings

ADMIN = "018f0000-0000-7000-8000-0000000000ab"
ACTOR = {"x-somnus-actor-id": ADMIN}
CORPUS = "/internal/v1/admin/corpus"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


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


class _Fetcher:
    def __init__(self) -> None:
        self.urls: list[str] = []

    def __call__(self, url: str) -> FetchedPage:
        self.urls.append(url)
        if "broken" in url:
            raise WebPageError("that address is not on the public internet")
        return FetchedPage(url=url, title="Higiene", text="Texto de la página.\n\nSegundo.")


@pytest.fixture
def fetcher() -> _Fetcher:
    return _Fetcher()


@pytest.fixture
def client(corpus_engine: Engine, tmp_path: Path, fetcher: _Fetcher) -> Iterator[TestClient]:
    _clean(corpus_engine)
    app = create_app(Settings(service_name="somnus-report-service", env="test"))
    app.state.corpus_session_factory = sessionmaker(bind=corpus_engine, expire_on_commit=False)
    app.state.corpus_file_store = LocalCorpusFileStore(tmp_path)
    app.state.corpus_web_fetcher = fetcher
    with TestClient(app) as test_client:
        yield test_client
    _clean(corpus_engine)


def _draft(client: TestClient, rights: str | None = "own_document") -> str:
    body: dict[str, object] = {
        "title": "Guía de higiene del sueño",
        "citation": "The Somnus (2026).",
        "sourceType": "guideline",
        "locale": "es",
        "scopes": [{"scopeType": "general", "scopeKey": ""}],
    }
    if rights:
        body["rightsStatus"] = rights
    response = client.post(f"{CORPUS}/documents", json=body, headers=ACTOR)
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def _upload(client: TestClient, document_id: str, data: bytes, name: str = "Guía.docx"):
    return client.post(
        f"{CORPUS}/documents/{document_id}/file",
        json={"filename": name, "contentBase64": base64.b64encode(data).decode()},
        headers=ACTOR,
    )


def test_an_uploaded_word_file_becomes_the_draft_text_and_is_kept_downloadable(
    client: TestClient,
) -> None:
    document_id = _draft(client)
    data = _docx("Mantén horarios regulares.", "Evita pantallas en la cama.")

    response = _upload(client, document_id, data, name="Guía higiene.docx")
    assert response.status_code == 200, response.text
    document = response.json()
    assert document["status"] == "draft"
    assert document["chunkCount"] >= 1
    assert document["origin"]["kind"] == "file"
    assert document["origin"]["filename"] == "Guía higiene.docx"
    assert document["origin"]["contentType"] == DOCX
    assert document["origin"]["sizeBytes"] == len(data)
    assert document["origin"]["addedAt"].endswith("Z")

    detail = client.get(f"{CORPUS}/documents/{document_id}").json()
    assert "Mantén horarios regulares." in "\n".join(detail["chunks"])
    assert detail["document"]["origin"]["kind"] == "file"

    listed = client.post(f"{CORPUS}/documents/search", json={}, headers=ACTOR).json()
    assert listed["documents"][0]["origin"]["filename"] == "Guía higiene.docx"

    download = client.get(f"{CORPUS}/documents/{document_id}/file")
    assert download.status_code == 200
    original = download.json()
    assert base64.b64decode(original["contentBase64"]) == data
    assert original["contentType"] == DOCX
    assert original["filename"] == "Guía higiene.docx"


def test_a_file_that_is_not_pdf_or_word_is_refused_and_changes_nothing(
    client: TestClient,
) -> None:
    document_id = _draft(client)
    response = _upload(client, document_id, b"\x89PNG\r\n\x1a\n" + b"\x00" * 100, "foto.png")
    assert response.status_code == 422
    assert "PDF and Word" in response.json()["detail"]
    document = client.get(f"{CORPUS}/documents/{document_id}").json()["document"]
    assert document["origin"] is None
    assert document["chunkCount"] == 0
    assert client.get(f"{CORPUS}/documents/{document_id}/file").status_code == 404


def test_a_published_document_takes_no_new_text_from_a_file_or_a_page(
    client: TestClient, fetcher: _Fetcher
) -> None:
    document_id = _draft(client)
    assert _upload(client, document_id, _docx("Texto aprobado.")).status_code == 200
    published = client.post(
        f"{CORPUS}/documents/{document_id}/publish",
        json={"changelog": "Alta de la guía."},
        headers=ACTOR,
    )
    assert published.status_code == 200, published.text

    assert _upload(client, document_id, _docx("Otro texto.")).status_code == 409
    page = client.post(
        f"{CORPUS}/documents/{document_id}/web-page",
        json={"url": "https://example.org/otra"},
        headers=ACTOR,
    )
    assert page.status_code == 409
    # Refused before any fetch: a published document's text is not up for change.
    assert fetcher.urls == []
    # The original stays downloadable after publishing.
    assert client.get(f"{CORPUS}/documents/{document_id}/file").status_code == 200


def test_the_citation_only_cap_still_applies_to_uploaded_text(client: TestClient) -> None:
    document_id = _draft(client, rights="citation_only")
    response = _upload(client, document_id, _docx("Palabra " * 2_000))
    assert response.status_code == 409
    assert client.get(f"{CORPUS}/documents/{document_id}").json()["document"]["origin"] is None


def test_a_draft_without_rights_still_cannot_be_published_after_an_upload(
    client: TestClient,
) -> None:
    document_id = _draft(client, rights=None)
    assert _upload(client, document_id, _docx("Texto.")).status_code == 200
    refused = client.post(
        f"{CORPUS}/documents/{document_id}/publish",
        json={"changelog": "Alta."},
        headers=ACTOR,
    )
    assert refused.status_code == 409


def test_a_web_page_becomes_the_draft_text_with_its_url(
    client: TestClient, fetcher: _Fetcher
) -> None:
    document_id = _draft(client)
    response = client.post(
        f"{CORPUS}/documents/{document_id}/web-page",
        json={"url": "https://example.org/higiene"},
        headers=ACTOR,
    )
    assert response.status_code == 200, response.text
    origin = response.json()["origin"]
    assert origin["kind"] == "web_page"
    assert origin["sourceUrl"] == "https://example.org/higiene"
    assert origin["filename"] is None
    chunks = client.get(f"{CORPUS}/documents/{document_id}").json()["chunks"]
    assert "Texto de la página." in "\n".join(chunks)
    # A page has no stored original to download.
    assert client.get(f"{CORPUS}/documents/{document_id}/file").status_code == 404


def test_a_refused_page_says_why_and_changes_nothing(client: TestClient) -> None:
    document_id = _draft(client)
    response = client.post(
        f"{CORPUS}/documents/{document_id}/web-page",
        json={"url": "https://broken.example/"},
        headers=ACTOR,
    )
    assert response.status_code == 422
    assert "public internet" in response.json()["detail"]
    assert client.get(f"{CORPUS}/documents/{document_id}").json()["document"]["origin"] is None


def test_uploads_are_attributed_and_refused_without_storage(client: TestClient) -> None:
    document_id = _draft(client)
    anonymous = client.post(
        f"{CORPUS}/documents/{document_id}/file",
        json={"filename": "a.docx", "contentBase64": base64.b64encode(_docx("Texto.")).decode()},
    )
    assert anonymous.status_code == 400

    client.app.state.corpus_file_store = None  # type: ignore[attr-defined]
    assert _upload(client, document_id, _docx("Texto.")).status_code == 503


def test_a_body_that_is_not_base64_is_refused(client: TestClient) -> None:
    document_id = _draft(client)
    response = client.post(
        f"{CORPUS}/documents/{document_id}/file",
        json={"filename": "a.pdf", "contentBase64": "not base64 at all!"},
        headers=ACTOR,
    )
    assert response.status_code == 400
