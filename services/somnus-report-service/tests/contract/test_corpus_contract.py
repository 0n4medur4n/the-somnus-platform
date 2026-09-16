"""Contract test: the corpus DTOs conform to the shared JSON Schema (16.3).

`report.schemas.corpus` is a mirror of `packages/api-contracts/src/reporting/
corpus.ts`, which is the source of truth (build plan §3.4). A mirror nobody
checks is a second opinion waiting to happen, so this validates real payloads
against the generated schemas AND compares field sets in both directions — a
field added on one side and forgotten on the other fails here rather than in
production, where it would surface as a console that silently drops a value.

It also re-asserts the §B3 / §B3.1 absences at the contract level: no schema for
deleting anything, and no request property naming what the clinical artifact
owns.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest

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

SCHEMA_DIR = Path(__file__).resolve().parents[4] / "schemas" / "json-schema" / "corpus"

ADMIN = "018f0000-0000-7000-8000-0000000000ab"

DOCUMENT = CorpusDocumentDTO(
    id="018f0000-0000-7000-8000-0000000000cd",
    title="Higiene del sueño en adultos",
    citation="The Somnus (2026). Guía interna.",
    source_type="guideline",
    locale="es",
    status="published",
    rights_status="own_document",
    rights_evidence=CorpusRightsEvidenceDTO(),
    added_by=ADMIN,
    corpus_version_added=3,
    corpus_version_retired=None,
    retired_reason=None,
    scopes=[CorpusScopeDTO(scope_type="module", scope_key="INS")],
    chunk_count=2,
)

CASES: list[tuple[str, Any]] = [
    ("CorpusDocument", DOCUMENT),
    ("CorpusDocumentDetail", CorpusDocumentDetailDTO(document=DOCUMENT, chunks=["Un párrafo."])),
    ("CorpusDocumentPage", CorpusDocumentPageDTO(documents=[DOCUMENT], current_version=3)),
    (
        "CorpusDocumentCreateRequest",
        CorpusDocumentCreateRequestDTO(
            title="Higiene del sueño",
            citation="The Somnus (2026).",
            source_type="guideline",
            locale="es",
            scopes=[CorpusScopeDTO(scope_type="clinical_source", scope_key="SRC-05")],
            rights_status="open_access",
            rights_evidence=CorpusRightsEvidenceDTO(
                licence="CC BY 4.0", url="https://example.org/oa"
            ),
            text="Un párrafo aprobado.",
        ),
    ),
    ("CorpusDocumentEditRequest", CorpusDocumentEditRequestDTO(title="Revisada")),
    ("CorpusPublishRequest", CorpusPublishRequestDTO(changelog="Alta de la guía.")),
    (
        "CorpusRetireRequest",
        CorpusRetireRequestDTO(reason="Sustituida.", changelog="Retirada."),
    ),
    (
        "CorpusVersionResult",
        CorpusVersionResultDTO(
            document_id="018f0000-0000-7000-8000-0000000000cd",
            status="retired",
            corpus_version=4,
        ),
    ),
    ("CorpusSearchRequest", CorpusSearchRequestDTO(status="published", limit=10)),
    (
        "SrcEnrichmentPage",
        SrcEnrichmentPageDTO(
            sources=[
                SrcEnrichmentViewDTO(
                    artifact=SrcArtifactFieldsDTO(
                        id="SRC-05",
                        citation="AASM Clinical Practice Guideline (2017)",
                        url="https://example.org/aasm-2017",
                        use="Umbrales de latencia de sueño",
                        cited_by_rules=["SAFE-006"],
                    ),
                    content_version="1.1",
                    enrichments=[DOCUMENT],
                )
            ]
        ),
    ),
]


def _schema(name: str) -> dict[str, Any]:
    return json.loads((SCHEMA_DIR / f"{name}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name,dto", CASES, ids=[name for name, _ in CASES])
def test_dto_payload_conforms_to_the_generated_schema(name: str, dto: Any) -> None:
    jsonschema.validate(dto.model_dump(by_alias=True, mode="json"), _schema(name))


@pytest.mark.parametrize("name,dto", CASES, ids=[name for name, _ in CASES])
def test_the_two_sides_declare_the_same_fields(name: str, dto: Any) -> None:
    """Both directions, because either omission is a silent data loss.

    A property in the schema the DTO lacks means the console sends something this
    service drops; a field in the DTO the schema lacks means this service answers
    with something the console's `.strict()` parse will reject.
    """
    schema_properties = set(_schema(name).get("properties", {}))
    dto_fields = set(type(dto).model_json_schema(by_alias=True).get("properties", {}))
    assert dto_fields == schema_properties


def test_no_schema_describes_deleting_anything() -> None:
    """§B3: append and retire. There is no delete request, so there is no schema."""
    names = {path.stem.lower() for path in SCHEMA_DIR.glob("*.json")}
    assert names, "the corpus schemas were not generated"
    assert not any("delete" in name or "remove" in name or "purge" in name for name in names)


@pytest.mark.parametrize(
    "name",
    [
        "CorpusDocumentCreateRequest",
        "CorpusDocumentEditRequest",
        "CorpusPublishRequest",
        "CorpusRetireRequest",
        "CorpusSearchRequest",
    ],
)
def test_no_request_schema_names_what_the_clinical_artifact_owns(name: str) -> None:
    """§B3.1, asserted against the generated contract rather than the code.

    `citation` is excluded deliberately: a console document has a citation of its
    own. What must never appear is an SRC's identifier, its `use`, or the rules
    that cite it — the fields the deterministic engine stamps onto a result.
    """
    properties = set(_schema(name).get("properties", {}))
    assert properties.isdisjoint({"id", "use", "citedByRules", "sourceId", "srcId"})
