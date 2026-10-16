"""Contract test: the report request DTO conforms to the shared JSON Schema.

Same cross-language guard as morpheo: the Python provider DTO is validated
against schemas/json-schema/report/, generated from the Zod source of truth.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from report.application.render_service import RenderService
from report.infrastructure.storage import LocalStorageBackend
from report.schemas.render import ClinicalContentDTO, ReportRenderRequestDTO

RequestBuilder = Callable[..., ReportRenderRequestDTO]
SCHEMA_DIR = Path(__file__).resolve().parents[4] / "schemas" / "json-schema" / "report"


def _schema(name: str) -> dict[str, Any]:
    return json.loads((SCHEMA_DIR / f"{name}.json").read_text(encoding="utf-8"))


def test_render_request_dto_conforms(make_request: RequestBuilder) -> None:
    dto = make_request(level="L1", routes=("SLP",))
    payload = dto.model_dump(by_alias=True, mode="json")
    jsonschema.validate(payload, _schema("ReportRenderRequest"))
    assert set(payload) == {
        "assessmentId",
        "definitionVersion",
        "contentVersion",
        "locale",
        "role",
        "level",
        "stop",
        "triggeredRules",
        "routes",
        "completedAt",
    }


def test_null_level_request_conforms(make_request: RequestBuilder) -> None:
    dto = make_request(level=None, routes=())
    jsonschema.validate(dto.model_dump(by_alias=True, mode="json"), _schema("ReportRenderRequest"))


def test_schema_rejects_unknown_field(make_request: RequestBuilder) -> None:
    payload = make_request().model_dump(by_alias=True, mode="json") | {"recompute": True}
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(payload, _schema("ReportRenderRequest"))


def test_the_on_demand_pdf_response_conforms(
    tmp_path: Path, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    class _Content:
        def get_content(self) -> ClinicalContentDTO:
            return content

    class _Pdf:
        def to_pdf(self, html: str) -> bytes:
            return b"%PDF-1.7 " + html.encode("utf-8")

    service = RenderService(
        content_provider=_Content(),
        pdf_renderer=_Pdf(),
        storage=LocalStorageBackend(root=tmp_path, base_url="http://x/reports"),
        signed_url_ttl=timedelta(minutes=15),
    )
    dto = service.render_pdf(make_request(locale="es", level="L4", routes=("INS",)))

    jsonschema.validate(dto.model_dump(by_alias=True, mode="json"), _schema("ReportPdf"))
    assert base64.b64decode(dto.pdf_base64).startswith(b"%PDF-")
    # On demand means not stored: nothing was written.
    assert list(tmp_path.rglob("*")) == []


def test_the_person_report_response_conforms() -> None:
    from report.schemas.narrative import NarrativeDTO, NarrativeResponseDTO

    narrative = NarrativeDTO.model_validate(
        {
            "summary": "Resumen.",
            "whatToDo": ["Pide consulta."],
            "patterns": [{"name": "Dificultad para dormir", "why": "Despertares."}],
            "recommendations": ["Diario de sueño."],
            "prepare": ["Apunta desde cuándo."],
        }
    )
    for dto in (
        NarrativeResponseDTO(assessment_id="s1", locale="es", generated=True, narrative=narrative),
        NarrativeResponseDTO(assessment_id="s1", locale="es", generated=False),
    ):
        jsonschema.validate(
            dto.model_dump(by_alias=True, mode="json"), _schema("PersonReportResponse")
        )
