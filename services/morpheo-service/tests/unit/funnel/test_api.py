"""The v2 interview over HTTP: the engine serves each step, the API only carries it.

Runs on an in-memory SQLite database for speed; the same routes run against
real MySQL in tests/integration/test_funnel_api_db.py.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.interview import Answer, next_step
from morpheo.funnel.vignettes import answer_request, load_vignettes, run_vignette, scripted_answer
from morpheo.infrastructure.models import Base, FunnelAnswer, FunnelSession
from morpheo.instruments.definitions import load_registry
from morpheo.main import create_app
from morpheo.settings.config import Settings

A = funnel_artifact()
VIGNETTES = load_vignettes()
BASE = "/internal/v1/funnel"
ACTOR = "Somnus-Actor"


def _client(**settings: Any) -> TestClient:
    app = create_app(Settings(_env_file=None, **settings))
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine, tables=[FunnelSession.__table__, FunnelAnswer.__table__])
    app.state.session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    return TestClient(app)


@pytest.fixture
def client() -> Iterator[TestClient]:
    with _client() as test_client:
        yield test_client


def _start(client: TestClient, actor: str | None = None) -> dict[str, Any]:
    headers = {"X-Somnus-Actor-Id": actor} if actor else {}
    response = client.post(f"{BASE}/sessions", json={"consentGiven": True}, headers=headers)
    assert response.status_code == 200, response.text
    state: dict[str, Any] = response.json()
    return state


def _answer(client: TestClient, state: dict[str, Any], body: dict[str, Any]) -> Any:
    return client.post(f"{BASE}/sessions/{state['sessionId']}/answers", json=body)


def _play(client: TestClient, vignette: dict[str, Any]) -> dict[str, Any]:
    """Plays a vignette over HTTP, checking at every step that the API serves
    exactly the step the engine would."""
    registry = load_registry(Settings(_env_file=None))
    state = _start(client)
    local: dict[str, Answer] = {}
    for _ in range(200):
        step = next_step(A, local, registry)
        if step is None:
            assert state["step"] is None
            return state
        assert state["step"]["key"] == step.key
        answer, _ = scripted_answer(vignette, step)
        response = _answer(client, state, answer_request(step.key, answer, step.definition))
        assert response.status_code == 200, (step.key, response.text)
        state = response.json()
        local[step.key] = answer
    raise AssertionError("did not finish")


@pytest.mark.parametrize("vignette", VIGNETTES, ids=lambda v: v["id"])
def test_every_vignette_ends_with_the_runners_final_text(
    client: TestClient, vignette: dict[str, Any]
) -> None:
    state = _play(client, vignette)
    expected = run_vignette(vignette).result
    assert state["result"]["texts"] == [{"template": t, "text": x} for t, x in expected.texts]
    assert state["result"]["mainAction"] == expected.accion_principal
    assert state["status"] in ("finished", "stopped")


def test_the_first_step_is_the_age(client: TestClient) -> None:
    state = _start(client)
    step = state["step"]
    assert (step["key"], step["type"], step["unit"], step["phase"]) == (
        "AGE",
        "number",
        "años",
        "start",
    )
    assert step["text"] == "¿Qué edad tiene?"
    assert state["owned"] is False and state["history"] == []


def test_only_the_step_being_served_can_be_answered(client: TestClient) -> None:
    state = _start(client)
    response = _answer(client, state, {"key": "Q05", "value": 4})
    assert response.status_code == 422
    assert response.json() == {"detail": "not_the_current_step"}


def test_an_answer_must_fit_the_step(client: TestClient) -> None:
    state = _start(client)
    assert _answer(client, state, {"key": "AGE", "value": "cuarenta"}).status_code == 422
    assert _answer(client, state, {"key": "AGE", "value": 140}).status_code == 422
    assert (
        _answer(client, state, {"key": "AGE", "value": 40, "absence": "no_lo_se"}).status_code
        == 422
    )
    assert _answer(client, state, {"key": "AGE", "absence": "no_lo_se"}).status_code == 200


def test_free_text_with_identifying_data_is_refused(client: TestClient) -> None:
    state = _start(client)
    for key, value in (("AGE", 40), ("S1@start", "no"), ("S4@start", "no")):
        state = _answer(client, state, {"key": key, "value": value}).json()
    assert state["step"]["key"] == "Q01" and state["step"]["type"] == "free_text"
    response = _answer(
        client, state, {"key": "Q01", "value": "Duermo mal, llamadme al 612 345 678"}
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "identifying_data"}


def test_s1_yes_at_the_start_stops_with_the_safety_text(client: TestClient) -> None:
    state = _start(client)
    state = _answer(client, state, {"key": "AGE", "value": 40}).json()
    state = _answer(client, state, {"key": "S1@start", "value": "si"}).json()
    assert state["status"] == "stopped" and state["step"] is None
    assert state["result"]["mainAction"] == "EMERGENCIA"
    assert state["result"]["texts"][0]["template"] == "T_SEGURIDAD"


def test_back_undoes_the_last_answer(client: TestClient) -> None:
    state = _start(client)
    state = _answer(client, state, {"key": "AGE", "value": 40}).json()
    state = _answer(client, state, {"key": "S1@start", "value": "no"}).json()
    assert state["step"]["key"] == "S4@start"
    back = client.post(f"{BASE}/sessions/{state['sessionId']}/back").json()
    assert back["step"]["key"] == "S1@start"
    assert [item["key"] for item in back["history"]] == ["AGE"]
    assert back["history"][0]["answer"] == "40 años"


def test_z1_correction_rewinds_to_the_answer_and_drops_what_followed(client: TestClient) -> None:
    state = _play(client, next(v for v in VIGNETTES if v["id"] == "FT-1"))
    assert state["status"] == "finished"
    rewound = client.post(
        f"{BASE}/sessions/{state['sessionId']}/rewind", json={"key": "Q05"}
    ).json()
    assert rewound["status"] == "open" and rewound["result"] is None
    assert rewound["step"]["key"] == "Q05"
    assert "Q06" not in [item["key"] for item in rewound["history"]]
    unknown = client.post(f"{BASE}/sessions/{state['sessionId']}/rewind", json={"key": "R6"})
    assert unknown.status_code == 422


def test_someones_own_interview_is_invisible_to_anyone_else(client: TestClient) -> None:
    state = _start(client, actor=ACTOR)
    assert state["owned"] is True
    session = f"{BASE}/sessions/{state['sessionId']}"
    assert client.get(session).status_code == 404
    assert client.get(session, headers={"X-Somnus-Actor-Id": "someone-else"}).status_code == 404
    assert client.get(session, headers={"X-Somnus-Actor-Id": ACTOR}).status_code == 200
    assert client.post(f"{session}/answers", json={"key": "AGE", "value": 40}).status_code == 404


def test_each_step_carries_the_team_panel(client: TestClient) -> None:
    state = _start(client)
    panel = state["step"]["panel"]
    assert panel["source"] == "AGE"
    assert set(panel) == {
        "reason",
        "source",
        "branchesOpened",
        "rulesFired",
        "mainAction",
        "phraseIds",
        "instruments",
    }


def test_the_s2_warning_and_safe_place_question_are_served_as_steps(client: TestClient) -> None:
    state = _start(client)
    for key, value in (("AGE", 50), ("S1@start", "no"), ("S4@start", "no")):
        state = _answer(client, state, {"key": key, "value": value}).json()
    state = _answer(
        client, state, {"key": "Q01", "value": "Soy camionero y conduzco de noche"}
    ).json()
    assert state["step"]["key"] == "S2@exception:Q01"
    state = _answer(client, state, {"key": "S2@exception:Q01", "value": "si"}).json()
    assert (state["step"]["key"], state["step"]["kind"]) == ("S2_aviso", "info")
    assert state["step"]["text"].startswith("Si conduce o maneja maquinaria")
    assert _answer(client, state, {"key": "S2_aviso", "absence": "no_lo_se"}).status_code == 422
    state = _answer(client, state, {"key": "S2_aviso", "value": "visto"}).json()
    assert state["step"]["key"] == "S2_seguro"
    state = _answer(client, state, {"key": "S2_seguro", "value": "no"}).json()
    assert state["status"] == "paused"
    assert [t["template"] for t in state["result"]["texts"]][-1] == "S2_pausa"


def test_consent_is_required_to_start(client: TestClient) -> None:
    response = client.post(f"{BASE}/sessions", json={"consentGiven": False})
    assert response.status_code == 422


def test_the_config_says_which_flow_the_app_runs() -> None:
    with _client() as on:
        assert on.get(f"{BASE}/config").json() == {"activeFlow": "v2"}
    with _client(funnel_v2_enabled=False) as off:
        assert off.get(f"{BASE}/config").json() == {"activeFlow": "v1"}
