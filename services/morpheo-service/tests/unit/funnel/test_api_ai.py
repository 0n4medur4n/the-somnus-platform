"""The v2 API with the AI on, from recorded outputs: the confirmation screen over HTTP."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from morpheo.ai.narrative import recorded_provider
from morpheo.ai.pipeline import AiExtractor
from morpheo.ai.provider import FailingProvider
from morpheo.infrastructure.models import Base, FunnelAnswer, FunnelSession
from morpheo.main import create_app
from morpheo.settings.config import Settings

BASE = "/internal/v1/funnel"
NARRATIVE = (
    "Desde hace unos seis meses me despierto casi todas las noches y me cuesta volver a dormirme."
)


def _client(extractor: AiExtractor | None) -> TestClient:
    app = create_app(Settings(_env_file=None))
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine, tables=[FunnelSession.__table__, FunnelAnswer.__table__])
    app.state.session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    app.state.ai = extractor
    return TestClient(app)


@pytest.fixture
def client() -> Iterator[TestClient]:
    provider, _ = recorded_provider()
    with _client(AiExtractor(provider)) as test_client:
        yield test_client


def _post(client: TestClient, state: dict[str, Any], body: dict[str, Any]) -> Any:
    return client.post(f"{BASE}/sessions/{state['sessionId']}/answers", json=body)


def _ok(client: TestClient, state: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    response = _post(client, state, body)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def _to_narrative(client: TestClient) -> dict[str, Any]:
    state = client.post(f"{BASE}/sessions", json={"consentGiven": True}).json()
    for body in (
        {"key": "AGE", "value": 52},
        {"key": "Q01", "value": NARRATIVE},
    ):
        state = _ok(client, state, body)
    return state


def test_the_narrative_is_followed_by_the_confirmation_screen(client: TestClient) -> None:
    step = _to_narrative(client)["step"]
    assert step["key"] == "Q01#confirmacion"
    assert step["kind"] == step["type"] == "confirm_extraction"
    assert step["text"] == "Por lo que nos ha contado, entendemos:"
    assert step["note"] == "¿Es correcto?"
    items = {i["id"]: i for i in step["extraction"]["items"]}
    assert items["Q03"]["question"] == "¿Desde cuándo le ocurre?"
    assert items["Q03"]["evidence"] == "Desde hace unos seis meses"
    assert items["Q03"]["editable"] is True and items["Q03"]["units"] == [
        "dias",
        "semanas",
        "meses",
        "años",
    ]
    assert step["answeredCount"] == 2  # the AI's record is not one of the person's answers
    [call] = step["panel"]["ai"]
    assert call["source"] == "Q01" and call["status"] == "ok"
    assert {i["decision"] for i in call["items"]} == {"pendiente"}


def test_confirmed_items_are_skipped_shown_in_z1_history_and_rewind_to_the_screen(
    client: TestClient,
) -> None:
    state = _to_narrative(client)
    corrected = {"id": "Q03", "decision": "corregido", "value": {"value": 7, "unit": "meses"}}
    state = _ok(
        client,
        state,
        {
            "key": "Q01#confirmacion",
            "decisions": [corrected, {"id": "Q08", "decision": "confirmado"}],
        },
    )
    assert state["step"]["key"] == "Q02"
    history = {h["key"]: h for h in state["history"]}
    assert history["Q03"]["answer"] == "7 meses"
    assert "Q08" in history and "Q01#confirmacion" not in history
    [call] = state["step"]["panel"]["ai"]
    decisions = {i["id"]: (i["decision"], i["corrected"]) for i in call["items"]}
    assert decisions == {"Q03": ("corregido", "7 meses"), "Q08": ("confirmado", None)}
    # Z1 «corregir» on an answer taken from the narrative: back to its screen.
    session = f"{BASE}/sessions/{state['sessionId']}"
    rewound = client.post(f"{session}/rewind", json={"key": "Q03"}).json()
    assert rewound["step"]["key"] == "Q01#confirmacion"


def test_back_from_the_confirmation_screen_returns_to_the_narrative(client: TestClient) -> None:
    state = _to_narrative(client)
    back = client.post(f"{BASE}/sessions/{state['sessionId']}/back").json()
    assert back["step"]["key"] == "Q01"


@pytest.mark.parametrize(
    "decisions",
    [
        [{"id": "Q03", "decision": "confirmado"}],
        [
            {"id": "Q03", "decision": "confirmado"},
            {"id": "Q08", "decision": "confirmado"},
            {"id": "Q05", "decision": "confirmado"},
        ],
        [
            {"id": "Q03", "decision": "corregido", "value": {"value": 7, "unit": "lunas"}},
            {"id": "Q08", "decision": "confirmado"},
        ],
        [
            {"id": "Q03", "decision": "corregido"},
            {"id": "Q08", "decision": "confirmado"},
        ],
        [
            {"id": "Q03", "decision": "confirmado", "value": {"value": 7, "unit": "meses"}},
            {"id": "Q08", "decision": "confirmado"},
        ],
        [{"id": "Q03", "decision": "confirmado"}, {"id": "Q03", "decision": "quitado"}],
    ],
)
def test_a_decision_set_that_does_not_fit_the_screen_is_refused(
    client: TestClient, decisions: list[dict[str, Any]]
) -> None:
    state = _to_narrative(client)
    response = _post(client, state, {"key": "Q01#confirmacion", "decisions": decisions})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


def test_decisions_are_refused_on_any_other_step(client: TestClient) -> None:
    state = client.post(f"{BASE}/sessions", json={"consentGiven": True}).json()
    response = _post(client, state, {"key": "AGE", "decisions": []})
    assert response.status_code == 422


def test_with_openai_down_the_interview_goes_on_and_asks_the_safety_questions() -> None:
    with _client(AiExtractor(FailingProvider("timeout"))) as client:
        state = _to_narrative(client)
        assert state["step"]["key"] == "S1@exception:Q01"
        assert "falló" in state["step"]["panel"]["reason"]
        for key in ("S1@exception:Q01", "S4@exception:Q01", "S2@exception:Q01"):
            assert state["step"]["key"] == key
            state = _ok(client, state, {"key": key, "value": "no"})
        assert state["step"]["key"] == "Q02"
        assert state["step"]["panel"]["ai"][0]["status"] == "failed"


def test_with_the_flag_off_nothing_is_sent_and_every_question_is_asked() -> None:
    with _client(None) as client:
        state = _to_narrative(client)
        assert state["step"]["key"] == "Q02"
        assert state["step"]["panel"]["ai"] == []


def test_the_flag_and_the_key_decide_whether_an_extractor_exists() -> None:
    from morpheo.ai.factory import build_extractor

    assert build_extractor(Settings(_env_file=None, ai_extraction_enabled=False)) is None
    assert build_extractor(Settings(_env_file=None, openai_api_key="")) is None
    assert build_extractor(Settings(_env_file=None, openai_api_key="sk-test")) is not None


def test_patient_data_only_through_the_eu_endpoint() -> None:
    with pytest.raises(ValueError, match=r"eu\.api\.openai\.com"):
        Settings(_env_file=None, patient_data_allowed=True, openai_api_key="sk-test")
    Settings(
        _env_file=None,
        patient_data_allowed=True,
        openai_api_key="sk-test",
        openai_base_url="https://eu.api.openai.com/v1",
    )


def test_recorded_outputs_are_refused_outside_local_runs_and_tests() -> None:
    with pytest.raises(ValueError, match="AI_FIXTURE_FILE"):
        Settings(_env_file=None, env="production", ai_fixture_file="x.json")
