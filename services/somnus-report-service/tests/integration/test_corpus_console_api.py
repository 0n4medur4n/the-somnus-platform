"""The corpus console's API half, against MySQL (Addendum B §B3 / §B3.1, 16.3).

The console is a screen, and a screen is a weak place to enforce a rule: anyone
with the capability can call these routes directly. So the properties Checkpoint
16.3 promises are asserted here, at the API boundary, not in the UI.

* A document really goes draft -> published -> retired through the real routes.
* There is no delete, anywhere, in any shape.
* Publish is refused **exactly** when §B4's gate would refuse it — the same
  function, not a second copy that agrees today.
* No request this API accepts can carry an SRC's identifier, citation, `use` or
  citing rules, so §B3.1's read-only fields are read-only by construction.
"""

from __future__ import annotations

import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from report.corpus.chunking import CITATION_ONLY_MAX_CHARACTERS
from report.corpus.models import (
    CorpusVersionRow,
    ReferenceDocumentChunkRow,
    ReferenceDocumentRow,
    ReferenceDocumentScopeRow,
)
from report.corpus.rights import RightsError, require_publishable
from report.main import create_app
from report.schemas.sources import ClinicalSourceDTO, ClinicalSourcesDTO
from report.settings.config import Settings

ADMIN = "018f0000-0000-7000-8000-0000000000ab"
ACTOR_HEADER = {"x-somnus-actor-id": ADMIN}
CORPUS = "/internal/v1/admin/corpus"

CONTENT_VERSION = "1.1"
SOURCES = ClinicalSourcesDTO(
    content_version=CONTENT_VERSION,
    sources=[
        ClinicalSourceDTO(
            id="SRC-05",
            citation="AASM Clinical Practice Guideline (2017)",
            url="https://example.org/aasm-2017",
            use="Umbrales de latencia de sueño",
            cited_by_rules=("SAFE-006",),
        ),
        ClinicalSourceDTO(
            id="SRC-11",
            citation="NICE NG202 (2021)",
            url="https://example.org/nice-ng202",
            use="Derivación en insomnio persistente",
            cited_by_rules=(),
        ),
    ],
)

#: Every field §B3.1 says the clinical artifact owns. None of them may be settable
#: through any console route, under any name.
ARTIFACT_OWNED_FIELDS = {
    "id": "SRC-05",
    "use": "un uso inventado",
    "citedByRules": ["SAFE-001"],
    "url": "https://attacker.example/replaced",
}


class _StubSources:
    """Read-only by construction: there is no method here that writes."""

    def __init__(self) -> None:
        self.calls = 0

    def get_sources(self) -> ClinicalSourcesDTO:
        self.calls += 1
        return SOURCES


@pytest.fixture
def sources() -> _StubSources:
    return _StubSources()


@pytest.fixture
def client(corpus_engine: Engine, sources: _StubSources) -> Iterator[TestClient]:
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
    # The migrated engine the fixture owns, so the test and the app agree about
    # which `somnus_content` they are talking to.
    app.state.corpus_session_factory = sessionmaker(bind=corpus_engine, expire_on_commit=False)
    app.state.corpus_sources_provider = sources
    with TestClient(app) as test_client:
        yield test_client


def _create(client: TestClient, **overrides: object) -> dict:
    body: dict[str, object] = {
        "title": "Higiene del sueño en adultos",
        "citation": "The Somnus (2026). Guía interna.",
        "sourceType": "guideline",
        "locale": "es",
        "rightsStatus": "own_document",
        "scopes": [{"scopeType": "module", "scopeKey": "INS"}],
        "text": "Primer párrafo aprobado.\n\nSegundo párrafo aprobado.",
    }
    body.update(overrides)
    response = client.post(f"{CORPUS}/documents", json=body, headers=ACTOR_HEADER)
    assert response.status_code == 201, response.text
    return response.json()


# --- the lifecycle the checkpoint exists to deliver ---------------------------


def test_a_document_goes_draft_to_published_to_retired_through_the_real_routes(
    client: TestClient,
) -> None:
    draft = _create(client)
    assert draft["status"] == "draft"
    # A draft belongs to no corpus version: it is not part of any corpus yet.
    assert draft["corpusVersionAdded"] is None
    assert draft["chunkCount"] == 2
    assert draft["addedBy"] == ADMIN
    document_id = draft["id"]

    published = client.post(
        f"{CORPUS}/documents/{document_id}/publish",
        json={"changelog": "Alta de la guía interna de higiene del sueño."},
        headers=ACTOR_HEADER,
    )
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"
    first_version = published.json()["corpusVersion"]
    assert first_version >= 1

    retired = client.post(
        f"{CORPUS}/documents/{document_id}/retire",
        json={"reason": "Sustituida por la edición de 2027.", "changelog": "Retirada."},
        headers=ACTOR_HEADER,
    )
    assert retired.status_code == 200, retired.text
    assert retired.json()["corpusVersion"] == first_version + 1

    # The row is still there, and still says what happened to it. That is the
    # whole point of retire-instead-of-delete (§B3).
    final = client.get(f"{CORPUS}/documents/{document_id}").json()["document"]
    assert final["status"] == "retired"
    assert final["corpusVersionAdded"] == first_version
    assert final["corpusVersionRetired"] == first_version + 1
    assert final["retiredReason"] == "Sustituida por la edición de 2027."


def test_search_narrows_and_still_shows_retired_documents(client: TestClient) -> None:
    kept = _create(client, title="Sueño y luz azul")
    other = _create(client, title="Cafeína vespertina", locale="en")

    client.post(
        f"{CORPUS}/documents/{kept['id']}/publish",
        json={"changelog": "Alta."},
        headers=ACTOR_HEADER,
    )
    client.post(
        f"{CORPUS}/documents/{kept['id']}/retire",
        json={"reason": "Obsoleta.", "changelog": "Retirada."},
        headers=ACTOR_HEADER,
    )

    everything = client.post(f"{CORPUS}/documents/search", json={}).json()
    assert {document["id"] for document in everything["documents"]} == {kept["id"], other["id"]}
    assert everything["currentVersion"] >= 2

    retired_only = client.post(f"{CORPUS}/documents/search", json={"status": "retired"}).json()
    assert [document["id"] for document in retired_only["documents"]] == [kept["id"]]

    by_locale = client.post(f"{CORPUS}/documents/search", json={"locale": "en"}).json()
    assert [document["id"] for document in by_locale["documents"]] == [other["id"]]

    by_query = client.post(f"{CORPUS}/documents/search", json={"query": "luz azul"}).json()
    assert [document["id"] for document in by_query["documents"]] == [kept["id"]]


def test_a_draft_is_editable_and_a_published_document_is_not(client: TestClient) -> None:
    draft = _create(client)
    edited = client.post(
        f"{CORPUS}/documents/{draft['id']}/edit",
        json={"title": "Higiene del sueño (revisada)", "text": "Un solo párrafo."},
        headers=ACTOR_HEADER,
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["title"] == "Higiene del sueño (revisada)"
    assert edited.json()["chunkCount"] == 1

    client.post(
        f"{CORPUS}/documents/{draft['id']}/publish",
        json={"changelog": "Alta."},
        headers=ACTOR_HEADER,
    )
    refused = client.post(
        f"{CORPUS}/documents/{draft['id']}/edit",
        json={"title": "Cambiado después de publicar"},
        headers=ACTOR_HEADER,
    )
    # A published document belongs to a corpus version some report may already be
    # stamped with. Retire it and publish another; do not rewrite history.
    assert refused.status_code == 409
    assert client.get(f"{CORPUS}/documents/{draft['id']}").json()["document"]["title"] != (
        "Cambiado después de publicar"
    )


def test_a_refused_edit_leaves_the_draft_exactly_as_it_was(client: TestClient) -> None:
    draft = _create(client, rightsStatus="citation_only", text="Un resumen breve.")
    over_cap = "x" * (CITATION_ONLY_MAX_CHARACTERS + 1)

    refused = client.post(
        f"{CORPUS}/documents/{draft['id']}/edit",
        json={"title": "Nuevo título", "text": over_cap},
        headers=ACTOR_HEADER,
    )
    assert refused.status_code == 409

    unchanged = client.get(f"{CORPUS}/documents/{draft['id']}").json()
    assert unchanged["document"]["title"] == draft["title"]
    assert unchanged["document"]["chunkCount"] == 1
    # The text an edit screen would have shown is still the text that was there.
    assert unchanged["chunks"] == ["Un resumen breve."]


def test_a_write_with_no_actor_is_refused(client: TestClient) -> None:
    anonymous = client.post(
        f"{CORPUS}/documents",
        json={
            "title": "Sin autor",
            "citation": "x",
            "sourceType": "guideline",
            "locale": "es",
            "scopes": [{"scopeType": "general", "scopeKey": ""}],
        },
    )
    # §B3's history is a record of who decided what belongs in the corpus. An
    # unattributed change is worse than no change.
    assert anonymous.status_code == 400
    assert client.post(f"{CORPUS}/documents/search", json={}).json()["documents"] == []


# --- the gate, and only the gate ---------------------------------------------


@pytest.mark.parametrize(
    "rights_status,evidence",
    [
        (None, None),
        ("own_document", None),
        ("citation_only", None),
        ("open_access", None),
        ("open_access", {"licence": "CC BY 4.0"}),
        ("open_access", {"licence": "CC BY 4.0", "url": "https://example.org/oa"}),
        ("open_access", {"licence": "   ", "url": "https://example.org/oa"}),
        ("licensed", None),
        ("licensed", {"licence": "Elsevier"}),
        ("licensed", {"licence": "Elsevier", "holder": "Hospital X"}),
    ],
)
def test_publish_is_refused_exactly_when_the_rights_gate_refuses(
    client: TestClient, rights_status: str | None, evidence: dict[str, str] | None
) -> None:
    """The API's answer and §B4's answer, compared case by case.

    Not "publish refuses bad rights" — that would pass against a second copy of
    the rule that happens to agree today. This asserts the two verdicts are the
    same verdict, which only holds while there is one gate.
    """
    # `rightsStatus` is always sent, null included: "nobody declared anything" is
    # one of the cases §B4 has to refuse, so the default must not fill it in.
    draft = _create(client, rightsStatus=rights_status, rightsEvidence=evidence or {})

    response = client.post(
        f"{CORPUS}/documents/{draft['id']}/publish",
        json={"changelog": "Alta."},
        headers=ACTOR_HEADER,
    )

    # The gate's verdict, computed from the same stored evidence the repository
    # read back when it decided.
    stored = client.get(f"{CORPUS}/documents/{draft['id']}").json()["document"]
    gate_refuses = False
    try:
        require_publishable(rights_status, _evidence_json(stored["rightsEvidence"]))
    except RightsError:
        gate_refuses = True

    assert (response.status_code == 409) is gate_refuses, response.text
    if not gate_refuses:
        assert response.json()["status"] == "published"


def _evidence_json(evidence: dict[str, str | None]) -> str:
    return json.dumps(
        {key: value for key, value in evidence.items() if value}, sort_keys=True, ensure_ascii=False
    )


# --- what the API cannot do ---------------------------------------------------


def _served_operations(client: TestClient) -> list[tuple[str, str]]:
    """Every (path, method) the assembled application serves.

    Read from the generated OpenAPI document rather than walked off
    `app.routes`: this FastAPI version keeps each included router as one opaque
    entry there, so the flat list holds the docs routes and nothing else. The
    OpenAPI document is also the better thing to assert against — it is what the
    service publishes as its surface, so "there is no delete" is a statement
    about what anyone can call, not about one router object's contents.
    """
    paths = client.app.openapi()["paths"]  # type: ignore[attr-defined]
    return [(path, method.upper()) for path, methods in paths.items() for method in methods]


def test_no_route_deletes_anything(client: TestClient) -> None:
    """Retire is reachable; delete is not a route that exists (§B3)."""
    served = _served_operations(client)
    assert served, "the application serves nothing at all"

    corpus = [(path, method) for path, method in served if path.startswith(CORPUS)]
    assert len(corpus) == 7, f"expected the seven corpus routes, got {sorted(corpus)}"

    # Nothing anywhere in this service deletes, not just nothing in the corpus:
    # §B3's rule is about the data, and a delete route elsewhere would reach the
    # same rows.
    for path, method in served:
        assert method != "DELETE", f"{method} {path} exists"
        assert "delete" not in path.lower(), f"{path} looks like a delete route"

    assert any(path.endswith("/retire") for path, _ in corpus)

    draft = _create(client)
    # Not "the UI hides it": the method is not routed at all.
    assert client.delete(f"{CORPUS}/documents/{draft['id']}").status_code == 405
    assert client.post(f"{CORPUS}/documents/search", json={}).json()["documents"] != []


@pytest.mark.parametrize("field,value", sorted(ARTIFACT_OWNED_FIELDS.items()))
def test_no_console_route_can_write_an_src_artifact_field(
    client: TestClient, field: str, value: object
) -> None:
    """§B3.1 at the API boundary, not in the UI.

    The identifier, citation, `use` and citing rules of a clinical source belong
    to `morpheo_workflows_v1.json`; the deterministic engine stamps them onto a
    result. If a console request could carry any of them, "read-only" would be a
    property of the screen and not of the system. These requests are refused as
    unknown fields before any handler runs.
    """
    draft = _create(client)

    create = client.post(
        f"{CORPUS}/documents",
        json={
            "title": "Intento",
            "citation": "x",
            "sourceType": "guideline",
            "locale": "es",
            "scopes": [{"scopeType": "clinical_source", "scopeKey": "SRC-05"}],
            field: value,
        },
        headers=ACTOR_HEADER,
    )
    edit = client.post(
        f"{CORPUS}/documents/{draft['id']}/edit",
        json={field: value},
        headers=ACTOR_HEADER,
    )
    assert create.status_code == 422, create.text
    assert edit.status_code == 422, edit.text


def test_citation_is_the_documents_own_and_never_an_src_field(client: TestClient) -> None:
    """`citation` is accepted — for the console's OWN document, which has one.

    The §B3.1 guarantee is not that the word never appears; it is that writing it
    changes only this enrichment document, and leaves the SRC entry the engine
    cites exactly as the artifact declares it.
    """
    enrichment = _create(
        client,
        citation="Nota interna sobre SRC-05",
        scopes=[{"scopeType": "clinical_source", "scopeKey": "SRC-05"}],
    )
    assert enrichment["citation"] == "Nota interna sobre SRC-05"

    page = client.get(f"{CORPUS}/sources").json()
    src = next(view for view in page["sources"] if view["artifact"]["id"] == "SRC-05")
    assert src["artifact"]["citation"] == "AASM Clinical Practice Guideline (2017)"
    assert [item["id"] for item in src["enrichments"]] == [enrichment["id"]]


# --- §B3.1: enrichment beside the artifact, never on top of it ----------------


def test_the_src_screen_shows_the_artifacts_own_fields(
    client: TestClient, sources: _StubSources
) -> None:
    page = client.get(f"{CORPUS}/sources").json()
    assert sources.calls == 1

    by_id = {view["artifact"]["id"]: view for view in page["sources"]}
    assert set(by_id) == {"SRC-05", "SRC-11"}
    assert by_id["SRC-05"]["artifact"] == {
        "id": "SRC-05",
        "citation": "AASM Clinical Practice Guideline (2017)",
        "url": "https://example.org/aasm-2017",
        "use": "Umbrales de latencia de sueño",
        "citedByRules": ["SAFE-006"],
    }
    # Version-bound: these fields are what the engine stamps for THIS content
    # version, so the console says which one it is looking at.
    assert by_id["SRC-05"]["contentVersion"] == CONTENT_VERSION
    assert by_id["SRC-11"]["enrichments"] == []


def test_enriching_a_source_leaves_its_artifact_fields_untouched(
    client: TestClient, sources: _StubSources
) -> None:
    before = client.get(f"{CORPUS}/sources").json()["sources"]

    enrichment = _create(
        client,
        title="Cómo explicamos SRC-05 a familias",
        scopes=[{"scopeType": "clinical_source", "scopeKey": "SRC-05"}],
    )
    client.post(
        f"{CORPUS}/documents/{enrichment['id']}/publish",
        json={"changelog": "Alta de la nota de SRC-05."},
        headers=ACTOR_HEADER,
    )

    after = client.get(f"{CORPUS}/sources").json()["sources"]
    assert [view["artifact"] for view in after] == [view["artifact"] for view in before]

    src = next(view for view in after if view["artifact"]["id"] == "SRC-05")
    assert [item["title"] for item in src["enrichments"]] == ["Cómo explicamos SRC-05 a familias"]
    assert src["enrichments"][0]["status"] == "published"
