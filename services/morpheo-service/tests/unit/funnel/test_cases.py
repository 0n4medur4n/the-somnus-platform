"""Every interview has a case (ADR 0024): a random code, the frozen record of
what was asked, answered and shown, the answers taken back, and every console
access. The case outlives the interview; statistics carry counts only.

Runs on in-memory SQLite, like test_api.py.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.interview import Answer, next_step
from morpheo.funnel.vignettes import answer_request, load_vignettes, scripted_answer
from morpheo.infrastructure.models import (
    Base,
    FunnelAnswer,
    FunnelCase,
    FunnelCaseAccess,
    FunnelCaseChange,
    FunnelCaseRecord,
    FunnelSession,
)
from morpheo.instruments.definitions import load_registry
from morpheo.main import create_app
from morpheo.repositories.cases import CaseRepository, new_code, normalise_code
from morpheo.repositories.funnel import FunnelRepository
from morpheo.settings.config import Settings

A = funnel_artifact()
VIGNETTES = load_vignettes()
BASE = "/internal/v1/funnel"
CASES = f"{BASE}/cases"
ADMIN = {"X-Somnus-Actor-Id": "admin-0001"}
CODE = re.compile(r"^SOM-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$")
WHY = {"category": "legal", "justification": "Reclamación formal recibida el 03/11, expediente 12."}


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app(Settings(_env_file=None))
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[
            m.__table__
            for m in (
                FunnelSession,
                FunnelAnswer,
                FunnelCase,
                FunnelCaseRecord,
                FunnelCaseChange,
                FunnelCaseAccess,
            )
        ],
    )
    app.state.session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    with TestClient(app) as test_client:
        yield test_client


def _db(client: TestClient) -> Session:
    session: Session = client.app.state.session_factory()  # type: ignore[attr-defined]
    return session


def _start(client: TestClient) -> dict[str, Any]:
    response = client.post(f"{BASE}/sessions", json={"consentGiven": True})
    assert response.status_code == 200, response.text
    state: dict[str, Any] = response.json()
    return state


def _answer(client: TestClient, state: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    response = client.post(f"{BASE}/sessions/{state['sessionId']}/answers", json=body)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def _minor(client: TestClient) -> dict[str, Any]:
    """The shortest closed interview: a minor stops it at the first step."""
    state = _answer(client, _start(client), {"key": "AGE", "value": 15})
    assert state["status"] == "stopped"
    return state


def _play(client: TestClient, vignette: dict[str, Any]) -> dict[str, Any]:
    registry = load_registry(Settings(_env_file=None))
    state = _start(client)
    local: dict[str, Answer] = {}
    for _ in range(200):
        step = next_step(A, local, registry)
        if step is None:
            return state
        answer, _ = scripted_answer(vignette, step)
        state = _answer(client, state, answer_request(step.key, answer, step.definition))
        local[step.key] = answer
    raise AssertionError("did not finish")


def _open(client: TestClient, code: str, headers: dict[str, str] = ADMIN) -> Any:
    return client.post(f"{CASES}/open", json={"caseCode": code, **WHY}, headers=headers)


# --- the code ---


def test_a_case_code_is_random_and_unambiguous() -> None:
    codes = {new_code() for _ in range(500)}
    assert len(codes) == 500
    assert all(CODE.match(c) for c in codes)


@pytest.mark.parametrize(
    ("typed", "expected"),
    [
        ("SOM-7K3F-Q9XA", "SOM-7K3F-Q9XA"),
        ("som-7k3f-q9xa", "SOM-7K3F-Q9XA"),
        (" SOM 7K3F Q9XA ", "SOM-7K3F-Q9XA"),
        ("7K3FQ9XA", "SOM-7K3F-Q9XA"),
        ("SOM-7K3F-Q9XO", "SOM-7K3F-Q9X0"),  # an O is read as a zero
        ("SOM-7K3F", None),
        ("SOM-7K3F-Q9XU", None),  # no U in the alphabet
        ("", None),
    ],
)
def test_a_typed_code_is_read_back_in_canonical_form(typed: str, expected: str | None) -> None:
    assert normalise_code(typed) == expected


# --- the record ---


def test_every_interview_has_a_case_from_the_first_step(client: TestClient) -> None:
    state = _start(client)
    assert CODE.match(state["caseCode"])
    again = client.get(f"{BASE}/sessions/{state['sessionId']}").json()
    assert again["caseCode"] == state["caseCode"]


def test_a_closed_interview_freezes_what_was_asked_answered_and_shown(
    client: TestClient,
) -> None:
    vignette = next(v for v in VIGNETTES if v["id"] == "FT-3")
    state = _play(client, vignette)
    case = _open(client, state["caseCode"]).json()

    assert case["status"] == state["status"]
    assert case["interviewDeleted"] is False
    [record] = case["records"]
    assert record["reconstructed"] is False
    assert record["history"] == state["history"]
    assert record["result"] == state["result"]
    assert record["rulesVersion"] == A.rules_version


def test_answers_taken_back_are_recorded_and_the_next_closure_is_a_new_record(
    client: TestClient,
) -> None:
    state = _minor(client)
    reopened = client.post(f"{BASE}/sessions/{state['sessionId']}/back").json()
    assert reopened["status"] == "open"
    _answer(client, reopened, {"key": "AGE", "value": 16})

    case = _open(client, state["caseCode"]).json()
    [change] = case["changes"]
    assert [w["key"] for w in change["withdrawn"]] == ["AGE"]
    assert change["withdrawn"][0]["answer"] == state["history"][0]["answer"]
    assert len(case["records"]) == 2
    assert [r["history"][0]["answer"] for r in case["records"]] != [
        state["history"][0]["answer"]
    ] * 2


def test_the_case_outlives_the_interview_without_a_link_to_anyone(client: TestClient) -> None:
    state = _minor(client)
    with _db(client) as db:
        assert FunnelRepository(db).delete_anonymous_before(datetime.now(UTC) + timedelta(days=1))
        assert db.get(FunnelSession, state["sessionId"]) is None
        case = db.get(FunnelCase, state["caseCode"])
        assert case is not None and case.session_id is None

    opened = _open(client, state["caseCode"]).json()
    assert opened["interviewDeleted"] is True
    assert opened["records"][0]["history"] == state["history"]


def test_account_erasure_also_keeps_the_case_unlinked(client: TestClient) -> None:
    response = client.post(
        f"{BASE}/sessions", json={"consentGiven": True}, headers={"X-Somnus-Actor-Id": "user-1"}
    )
    code = response.json()["caseCode"]
    with _db(client) as db:
        FunnelRepository(db).delete_owned_by("user-1")
        case = db.get(FunnelCase, code)
        assert case is not None and case.session_id is None


# --- opening a case ---


def test_opening_a_case_needs_the_admin_and_a_justification(client: TestClient) -> None:
    code = _minor(client)["caseCode"]
    assert _open(client, code, headers={}).status_code == 422
    short = {"caseCode": code, "category": "legal", "justification": "porque sí"}
    assert client.post(f"{CASES}/open", json=short, headers=ADMIN).status_code == 422
    bad_category = {**WHY, "caseCode": code, "category": "curiosity"}
    assert client.post(f"{CASES}/open", json=bad_category, headers=ADMIN).status_code == 422


def test_an_unknown_or_malformed_code_reads_as_not_found(client: TestClient) -> None:
    assert _open(client, "SOM-0000-0000").status_code == 404
    assert _open(client, "not a code").status_code == 404


def test_every_access_is_on_file_with_who_and_why(client: TestClient) -> None:
    code = _minor(client)["caseCode"]
    _open(client, code.lower().replace("-", ""))
    second = _open(client, code, headers={"X-Somnus-Actor-Id": "admin-0002"}).json()
    assert [(a["actorId"], a["category"]) for a in second["accesses"]] == [
        ("admin-0001", "legal"),
        ("admin-0002", "legal"),
    ]
    assert second["accesses"][0]["justification"] == WHY["justification"]


# --- statistics ---


def test_statistics_count_outcomes_and_never_carry_a_case(client: TestClient) -> None:
    played = _play(client, next(v for v in VIGNETTES if v["id"] == "FT-3"))
    minor = _minor(client)
    _start(client)  # still being answered

    response = client.post(f"{CASES}/stats", json={})
    stats = response.json()
    assert stats["started"] == 3
    assert stats["closed"] == 2
    assert stats["byStatus"] == {"open": 1, "finished": 1, "stopped": 1, "paused": 0}
    main = {c["key"]: c["count"] for c in stats["byMainAction"]}
    assert main.get(played["result"]["mainAction"]) == 1
    templates = {c["key"] for c in stats["byTemplate"]}
    assert {t["template"] for t in played["result"]["texts"]} <= templates
    assert [m["started"] for m in stats["byMonth"]] == [3]
    # Counts only: nothing that points at a case or a person.
    body = response.text
    for state in (played, minor):
        assert state["caseCode"] not in body and state["sessionId"] not in body


def test_statistics_take_a_window(client: TestClient) -> None:
    _minor(client)
    later = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    assert client.post(f"{CASES}/stats", json={"since": later}).json()["started"] == 0
    assert client.post(f"{CASES}/stats", json={"until": later}).json()["started"] == 1


# --- interviews from before cases, and retention ---


def test_interviews_older_than_cases_get_one_marked_reconstructed(client: TestClient) -> None:
    with _db(client) as db:
        session_id = FunnelRepository(db).create(None, A.content_version, A.rules_version)
        FunnelRepository(db).add_answer(session_id, "AGE", json.dumps(15), None, None)
        FunnelRepository(db).set_status(session_id, "stopped")
        FunnelRepository(db).create(None, A.content_version, A.rules_version)  # left open

    result = client.post("/internal/v1/maintenance/funnel-cases/backfill").json()
    assert result == {"opened": 2, "unrebuilt": 0}
    assert client.post("/internal/v1/maintenance/funnel-cases/backfill").json()["opened"] == 0

    with _db(client) as db:
        case = CaseRepository(db).for_session(session_id)
        assert case is not None and case.status == "stopped"
        [record] = CaseRepository(db).records(case.code)
        assert record.reconstructed is True


def test_retention_deletes_a_case_and_everything_recorded_about_it(client: TestClient) -> None:
    code = _minor(client)["caseCode"]
    _open(client, code)
    cutoff = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    deleted = client.post("/internal/v1/maintenance/funnel-cases/delete", json={"before": cutoff})
    assert deleted.json() == {"deleted": 1}
    with _db(client) as db:
        for model in (FunnelCaseRecord, FunnelCaseChange, FunnelCaseAccess):
            assert list(db.scalars(select(model).where(model.case_code == code))) == []
    assert _open(client, code).status_code == 404
