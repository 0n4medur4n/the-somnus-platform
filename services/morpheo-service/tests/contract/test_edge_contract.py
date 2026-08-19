"""Contract test for the edge <-> morpheo boundary (build plan §20 Checkpoint 10.2).

Validates the Python provider DTOs (src/morpheo/schemas/assessment.py) and the
engine's real output against the SAME generated JSON Schema the TypeScript
consumer uses (schemas/json-schema/morpheo/, produced from the Zod source of
truth in packages/api-contracts). A drift on the Python side fails here; the Zod
side owns the reciprocal drift guard (packages/api-contracts/.../morpheo.test.ts).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from pydantic import BaseModel

from morpheo.clinical.loader import load_clinical
from morpheo.clinical.models import ModuleId, RoleId, SafetyLevelId
from morpheo.domain.engine import AssessmentInput, run_assessment
from morpheo.schemas.assessment import (
    AnswerSubmitRequestDTO,
    AssessmentClaimRequestDTO,
    AssessmentClaimResponseDTO,
    AssessmentCreateRequestDTO,
    AssessmentCreateResponseDTO,
    AssessmentResultDTO,
    AssessmentSnapshotResponseDTO,
)
from morpheo.schemas.content import build_content_response
from morpheo.schemas.sources import build_clinical_sources

SCHEMA_DIR = Path(__file__).resolve().parents[4] / "schemas" / "json-schema" / "morpheo"
BUNDLE = load_clinical()


def _schema(name: str) -> dict[str, Any]:
    return json.loads((SCHEMA_DIR / f"{name}.json").read_text(encoding="utf-8"))


def _dump(dto: BaseModel) -> dict[str, Any]:
    return dto.model_dump(by_alias=True, mode="json")


def test_all_schema_artifacts_are_present() -> None:
    expected = {
        "AssessmentCreateRequest",
        "AssessmentCreateResponse",
        "AnswerSubmitRequest",
        "AssessmentResult",
        "AssessmentClaimRequest",
        "AssessmentClaimResponse",
        "AssessmentSnapshotResponse",
        "ClinicalSourcesResponse",
    }
    present = {path.stem for path in SCHEMA_DIR.glob("*.json")}
    assert expected <= present


# --- provider DTOs conform to the shared schema ---


def test_create_request_dto_conforms() -> None:
    dto = AssessmentCreateRequestDTO(
        role=RoleId.PARENT,
        consent_given=True,
        age_years=8,
        guardianship_confirmed=True,
        base_orientation="L2",
    )
    jsonschema.validate(_dump(dto), _schema("AssessmentCreateRequest"))


def test_create_response_dto_conforms_for_allowed_and_blocked() -> None:
    allowed = AssessmentCreateResponseDTO(allowed=True, session_id="abc", reason=None)
    blocked = AssessmentCreateResponseDTO(allowed=False, session_id=None, reason="consent_required")
    jsonschema.validate(_dump(allowed), _schema("AssessmentCreateResponse"))
    jsonschema.validate(_dump(blocked), _schema("AssessmentCreateResponse"))


def test_answer_submit_dto_conforms_for_complaint_and_signal() -> None:
    complaint = AnswerSubmitRequestDTO(kind="complaint", name="ronquido")
    signal = AnswerSubmitRequestDTO(kind="signal", name="witnessed_apneas", value="unknown")
    jsonschema.validate(_dump(complaint), _schema("AnswerSubmitRequest"))
    jsonschema.validate(_dump(signal), _schema("AnswerSubmitRequest"))


def test_claim_dtos_conform() -> None:
    request = AssessmentClaimRequestDTO(token="t-1")
    won = AssessmentClaimResponseDTO(success=True, snapshot_id="snap-1", reason=None)
    lost = AssessmentClaimResponseDTO(
        success=False, snapshot_id=None, reason="already_claimed_or_expired"
    )
    jsonschema.validate(_dump(request), _schema("AssessmentClaimRequest"))
    jsonschema.validate(_dump(won), _schema("AssessmentClaimResponse"))
    jsonschema.validate(_dump(lost), _schema("AssessmentClaimResponse"))


def test_snapshot_response_dto_conforms() -> None:
    result = AssessmentResultDTO(
        role=RoleId.ADULT,
        level=SafetyLevelId.L1,
        stop=True,
        privacy_block=False,
        routes=[ModuleId.SLP],
        triggered_rules=["SAFE-003"],
        workflow_version="1.0",
        content_version="1.0",
    )
    snapshot = AssessmentSnapshotResponseDTO(
        snapshot_id="snap-1",
        session_id="sess-1",
        result=result,
        workflow_version="1.0",
        content_version="1.0",
    )
    jsonschema.validate(_dump(snapshot), _schema("AssessmentSnapshotResponse"))


def test_content_response_from_artifacts_conforms() -> None:
    payload = _dump(build_content_response(BUNDLE))
    jsonschema.validate(payload, _schema("AssessmentContentResponse"))
    assert payload["locale"] == "es"
    assert len(payload["modules"]) == 6
    # The content endpoint reports the bumped content_version, not the rule version.
    assert payload["workflowVersion"] == "1.0"
    assert payload["contentVersion"] == "1.3"
    assert len(payload["safetyPrompts"]) == 22
    # Every BLOQUEAR claim statement is exposed for a consumer's scanner (§15).
    assert len(payload["blockedClaims"]) == 6
    assert any("sustituye una consulta" in claim for claim in payload["blockedClaims"])
    # The governed limits statements are the CLM-006/007/008 replacement text,
    # verbatim and in order (build plan §14b / §15).
    assert payload["limitsText"] == [
        "Morpheo organiza los síntomas y propone qué conviene valorar con un profesional.",
        (
            "Un resultado orientativo bajo no descarta un trastorno; "
            "consulta si los síntomas persisten o preocupan."
        ),
        "Información general y preguntas para comentar con tu profesional.",
    ]


def test_clinical_sources_from_artifacts_conforms() -> None:
    payload = _dump(build_clinical_sources(BUNDLE))
    jsonschema.validate(payload, _schema("ClinicalSourcesResponse"))
    # The fifteen approved clinical sources (SRC-01…SRC-15), for report grounding.
    assert len(payload["sources"]) == 15
    ids = {source["id"] for source in payload["sources"]}
    assert ids == {f"SRC-{n:02d}" for n in range(1, 16)}
    assert payload["contentVersion"] == "1.3"
    assert all(source["citation"] and source["use"] for source in payload["sources"])


# --- the engine's real output maps to a conforming result DTO ---


def test_engine_result_maps_and_conforms() -> None:
    # T-03: driving near-miss -> SLP, L1, stop.
    result = run_assessment(
        AssessmentInput(
            role=RoleId.ADULT,
            age_years=35,
            complaints=frozenset({"somnolencia al volante"}),
            safety_answers={"sleepiness_near_miss": True},
        ),
        BUNDLE,
    )
    payload = _dump(AssessmentResultDTO.from_result(result))
    jsonschema.validate(payload, _schema("AssessmentResult"))
    assert set(payload) == {
        "role",
        "level",
        "stop",
        "privacyBlock",
        "routes",
        "triggeredRules",
        "workflowVersion",
        "contentVersion",
    }
    assert payload["level"] == "L1"
    assert payload["stop"] is True
    assert payload["routes"] == ["SLP"]


def test_privacy_blocked_result_maps_and_conforms() -> None:
    # T-12: professional with identifiable data -> privacy block, no level/routes.
    result = run_assessment(
        AssessmentInput(
            role=RoleId.PROFESSIONAL,
            professional_confirmed=True,
            contains_identifiable_data=True,
        ),
        BUNDLE,
    )
    payload = _dump(AssessmentResultDTO.from_result(result))
    jsonschema.validate(payload, _schema("AssessmentResult"))
    assert payload["level"] is None
    assert payload["privacyBlock"] is True
    assert payload["routes"] == []


# --- the shared schema is genuinely strict (negative) ---


def _valid_result_payload() -> dict[str, Any]:
    return {
        "role": "adult",
        "level": "L1",
        "stop": True,
        "privacyBlock": False,
        "routes": ["SLP"],
        "triggeredRules": ["SAFE-003"],
        "workflowVersion": "1.0",
        "contentVersion": "1.0",
    }


def test_schema_rejects_unknown_field() -> None:
    payload = _valid_result_payload() | {"diagnosis": "insomnia"}
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(payload, _schema("AssessmentResult"))


def test_schema_rejects_unknown_enum_member() -> None:
    payload = _valid_result_payload() | {"role": "clinician"}
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(payload, _schema("AssessmentResult"))


def test_schema_requires_level_present_even_if_null() -> None:
    payload = _valid_result_payload()
    del payload["level"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(payload, _schema("AssessmentResult"))


# --- enum parity: the contract vocabulary equals morpheo's clinical enums ---


def test_role_enum_parity() -> None:
    schema = _schema("AssessmentResult")
    assert schema["properties"]["role"]["enum"] == [role.value for role in RoleId]


def test_module_enum_parity() -> None:
    schema = _schema("AssessmentResult")
    assert schema["properties"]["routes"]["items"]["enum"] == [module.value for module in ModuleId]


def test_level_enum_parity() -> None:
    schema = _schema("AssessmentResult")
    branches = schema["properties"]["level"]["anyOf"]
    enum_branch = next(branch for branch in branches if "enum" in branch)
    assert enum_branch["enum"] == [level.value for level in SafetyLevelId]
