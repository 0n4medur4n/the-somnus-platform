"""The v2 interview against the real MySQL schema (migration 5b2e9c41a7d3).

Order of answers, back/rewind deletes, owner isolation and the retention
deletes on real rows; the clinical behaviour is proven in the unit tests.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.interview import Answer, next_step
from morpheo.funnel.vignettes import answer_request, load_vignettes, run_vignette, scripted_answer
from morpheo.infrastructure.models import FunnelAnswer, FunnelSession
from morpheo.main import create_app

BASE = "/internal/v1/funnel"
MAINTENANCE = "/internal/v1/maintenance"


@pytest.fixture
def client(engine: Engine) -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


def _play(client: TestClient, vignette_id: str, actor: str | None = None) -> dict[str, Any]:
    headers = {"X-Somnus-Actor-Id": actor} if actor else {}
    vignette = next(v for v in load_vignettes() if v["id"] == vignette_id)
    body: dict[str, Any] = client.post(
        f"{BASE}/sessions", json={"consentGiven": True}, headers=headers
    ).json()
    answers: dict[str, Answer] = {}
    while body["step"] is not None:
        step = next_step(funnel_artifact(), answers, client.app.state.instruments)  # type: ignore[attr-defined]
        assert step is not None and step.key == body["step"]["key"]
        answer, _ = scripted_answer(vignette, step)
        response = client.post(
            f"{BASE}/sessions/{body['sessionId']}/answers",
            json=answer_request(step.key, answer, step.definition),
            headers=headers,
        )
        assert response.status_code == 200, response.text
        body = response.json()
        answers[step.key] = answer
    return body


def test_a_full_interview_is_stored_in_order_and_ends_with_the_runners_text(
    client: TestClient, engine: Engine
) -> None:
    state = _play(client, "V-10")
    expected = run_vignette(next(v for v in load_vignettes() if v["id"] == "V-10")).result
    assert state["result"]["texts"] == [{"template": t, "text": x} for t, x in expected.texts]
    with Session(engine) as session:
        keys = list(
            session.scalars(
                select(FunnelAnswer.step_key)
                .where(FunnelAnswer.session_id == state["sessionId"])
                .order_by(FunnelAnswer.id)
            )
        )
        stored = session.get(FunnelSession, state["sessionId"])
    assert keys[:3] == ["AGE", "Q01", "S2@exception:Q01"]
    assert keys[3:5] == ["S2_aviso", "S2_seguro"]
    assert stored is not None and stored.status == "finished" and stored.finished_at is not None


def test_back_and_rewind_delete_on_the_real_schema(client: TestClient, engine: Engine) -> None:
    state = _play(client, "FT-1")
    session_id = state["sessionId"]
    rewound = client.post(f"{BASE}/sessions/{session_id}/rewind", json={"key": "Q02"}).json()
    assert rewound["step"]["key"] == "Q02" and rewound["status"] == "open"
    back = client.post(f"{BASE}/sessions/{session_id}/back").json()
    assert back["step"]["key"] == "Q01"
    with Session(engine) as session:
        count = session.scalar(
            select(func.count())
            .select_from(FunnelAnswer)
            .where(FunnelAnswer.session_id == session_id)
        )
        stored = session.get(FunnelSession, session_id)
    assert count == 1  # AGE
    assert stored is not None and stored.status == "open" and stored.finished_at is None


def test_an_owned_interview_is_erased_with_the_account(client: TestClient, engine: Engine) -> None:
    owner = str(uuid.uuid4())
    state = _play(client, "FT-3", actor=owner)
    assert state["owned"] is True
    deleted = client.post(f"{MAINTENANCE}/user-assessments/delete", json={"userId": owner}).json()
    assert deleted["deleted"] >= 1
    with Session(engine) as session:
        assert session.get(FunnelSession, state["sessionId"]) is None
        assert not session.scalar(
            select(func.count())
            .select_from(FunnelAnswer)
            .where(FunnelAnswer.session_id == state["sessionId"])
        )


def test_anonymous_interviews_past_the_ttl_are_deleted_owned_ones_are_not(
    client: TestClient, engine: Engine
) -> None:
    long_ago = datetime(2020, 1, 1, tzinfo=UTC).replace(tzinfo=None)
    anonymous, owned = str(uuid.uuid4()), str(uuid.uuid4())
    with Session(engine) as session:
        for session_id, owner in ((anonymous, None), (owned, str(uuid.uuid4()))):
            session.add(
                FunnelSession(
                    id=session_id,
                    owner_id=owner,
                    consent_given=True,
                    status="open",
                    content_version="2.0",
                    rules_version="2.0",
                    created_at=long_ago,
                )
            )
        session.commit()
        session.add(FunnelAnswer(session_id=anonymous, step_key="AGE", value_json="40"))
        session.commit()
    cutoff = (long_ago + timedelta(days=1)).isoformat()
    client.post(f"{MAINTENANCE}/unclaimed-assessments/delete", json={"before": cutoff})
    with Session(engine) as session:
        assert session.get(FunnelSession, anonymous) is None
        assert session.get(FunnelSession, owned) is not None
        session.delete(session.get(FunnelSession, owned))
        session.commit()


def test_narrative_mode_stores_the_ai_record_and_the_decisions_on_the_real_schema(
    engine: Engine,
) -> None:
    """FT-1 with the AI on (recorded outputs): the same final text as the full run,
    the confirmed questions not asked, and both AI rows stored in order."""
    from morpheo.ai.narrative import recorded_provider
    from morpheo.ai.pipeline import AiExtractor
    from morpheo.funnel.interview import Step, special_step

    vignette = next(v for v in load_vignettes() if v["id"] == "FT-1")
    artifact = funnel_artifact()
    with TestClient(create_app()) as client:
        client.app.state.ai = AiExtractor(recorded_provider()[0])  # type: ignore[attr-defined]
        body: dict[str, Any] = client.post(f"{BASE}/sessions", json={"consentGiven": True}).json()
        asked: list[str] = []
        while body["step"] is not None:
            served = body["step"]
            asked.append(served["key"])
            if served["kind"] == "confirm_extraction":
                request: dict[str, Any] = {
                    "key": served["key"],
                    "decisions": [
                        {"id": i["id"], "decision": "confirmado"}
                        for i in served["extraction"]["items"]
                    ],
                }
            else:
                safety = served["questionId"] in ("S1", "S2", "S3", "S4")
                definition = special_step(served["key"]) or artifact.step(
                    served["questionId"], "end" if safety else None
                )
                step = Step(served["key"], definition, served["kind"])
                answer, _ = scripted_answer(vignette, step, narrative=True)
                request = answer_request(step.key, answer, definition)
                if served["type"] == "times":
                    fields = {f["key"] for f in served["fields"]}
                    request["value"] = {k: v for k, v in request["value"].items() if k in fields}
            response = client.post(f"{BASE}/sessions/{body['sessionId']}/answers", json=request)
            assert response.status_code == 200, response.text
            body = response.json()
    expected = run_vignette(vignette).result
    assert body["result"]["texts"] == [{"template": t, "text": x} for t, x in expected.texts]
    assert not {"Q03", "Q08", "I2"} & set(asked)
    with Session(engine) as session:
        keys = list(
            session.scalars(
                select(FunnelAnswer.step_key)
                .where(FunnelAnswer.session_id == body["sessionId"])
                .order_by(FunnelAnswer.id)
            )
        )
    assert keys[1:4] == ["Q01", "Q01#ia", "Q01#confirmacion"]


def test_the_result_carries_no_report_when_the_switch_is_off(client: TestClient) -> None:
    client.app.state.informe = None  # type: ignore[attr-defined]
    state = _play(client, "FT-1")
    assert state["result"] is not None and state["result"]["report"] is None


def test_the_result_carries_the_report_by_default(client: TestClient) -> None:
    report = _play(client, "FT-1")["result"]["report"]
    assert report["layout"] == "standard"
    assert report["headline"] and report["limits"] and report["professional"]["mainAction"]


def test_a_person_sees_their_own_finished_interviews_and_nobody_elses(
    client: TestClient,
) -> None:
    mine, theirs = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
    done = _play(client, "FT-1", actor=mine)["sessionId"]
    other = _play(client, "FT-2", actor=theirs)["sessionId"]
    anonymous = _play(client, "FT-3")["sessionId"]
    started = client.post(  # started, never finished
        f"{BASE}/sessions", json={"consentGiven": True}, headers={"X-Somnus-Actor-Id": mine}
    ).json()["sessionId"]

    listed = client.get(f"{BASE}/sessions", headers={"X-Somnus-Actor-Id": mine}).json()["sessions"]
    ids = [row["sessionId"] for row in listed]
    assert done in ids and started not in ids
    assert other not in ids and anonymous not in ids
    row = next(r for r in listed if r["sessionId"] == done)
    assert row["status"] == "finished" and row["mainAction"] and row["headline"]
    assert row["createdAt"].endswith("+00:00")
    # An interview that is listed opens for its owner, and only for them.
    assert (
        client.get(f"{BASE}/sessions/{done}", headers={"X-Somnus-Actor-Id": mine}).status_code
        == 200
    )
    assert (
        client.get(f"{BASE}/sessions/{done}", headers={"X-Somnus-Actor-Id": theirs}).status_code
        == 404
    )


def test_nothing_is_listed_without_an_actor(client: TestClient) -> None:
    _play(client, "FT-1", actor="33333333-3333-4333-8333-333333333333")
    assert client.get(f"{BASE}/sessions").json() == {"sessions": []}
