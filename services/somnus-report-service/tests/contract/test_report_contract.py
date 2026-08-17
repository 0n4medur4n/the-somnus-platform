"""Contract test: the report request DTO conforms to the shared JSON Schema.

Same cross-language guard as morpheo: the Python provider DTO is validated
against schemas/json-schema/report/, generated from the Zod source of truth.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from report.schemas.render import ReportRenderRequestDTO

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
