"""HTTP surface of the anonymous assessment flow (build plan §20 Checkpoint 10.3).

Drives the real FastAPI app with TestClient against the migrated MySQL schema.
The clinical behaviour is proven exhaustively in the engine/flow tests; here we
assert the provider adapter — routing, request validation, the contract DTOs on
the wire, and the edge-injected claimant identity.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from morpheo.main import create_app

BASE = "/internal/v1/assessments"


@pytest.fixture
def client(engine: Engine) -> Iterator[TestClient]:
    # `engine` migrates the shared DB to head; the app builds its own session.
    with TestClient(create_app()) as test_client:
        yield test_client


def _create_adult(client: TestClient) -> str:
    response = client.post(BASE, json={"role": "adult", "consentGiven": True, "ageYears": 35})
    assert response.status_code == 200
    body = response.json()
    assert body["allowed"] is True
    assert body["sessionId"]
    return str(body["sessionId"])


def test_full_flow_create_answer_summary_claim_snapshot(client: TestClient) -> None:
    session_id = _create_adult(client)

    client.post(
        f"{BASE}/{session_id}/answers", json={"kind": "complaint", "name": "somnolencia al volante"}
    )
    answered = client.post(
        f"{BASE}/{session_id}/answers",
        json={"kind": "signal", "name": "sleepiness_near_miss", "value": "true"},
    )
    assert answered.status_code == 200
    result = answered.json()
    assert result["level"] == "L1"
    assert result["stop"] is True
    assert result["routes"] == ["SLP"]

    summary = client.get(f"{BASE}/{session_id}/summary")
    assert summary.status_code == 200
    assert summary.json()["level"] == "L1"

    token = client.post(f"{BASE}/{session_id}/claim-token").json()["token"]
    assert token

    claimed = client.post(
        f"{BASE}/claim", json={"token": token}, headers={"X-Somnus-Actor-Id": "user-1"}
    )
    assert claimed.status_code == 200
    claim_body = claimed.json()
    assert claim_body["success"] is True
    snapshot_id = claim_body["snapshotId"]
    assert snapshot_id

    snapshot = client.get(f"{BASE}/{session_id}/snapshot")
    assert snapshot.status_code == 200
    snap_body = snapshot.json()
    assert snap_body["snapshotId"] == snapshot_id
    assert snap_body["result"]["level"] == "L1"


def test_content_endpoint_serves_artifact_wording(client: TestClient) -> None:
    response = client.get(f"{BASE}/content")
    assert response.status_code == 200
    body = response.json()
    assert body["locale"] == "es"
    assert {module["id"] for module in body["modules"]} == {
        "INS",
        "BRE",
        "SLP",
        "CIR",
        "RLS",
        "PAR",
    }
    assert {level["id"] for level in body["safetyLevels"]} == {"L0", "L1", "L2", "L3", "L4"}
    assert body["outputContract"]["forbiddenPhrases"]
    assert body["contentVersion"] == "1.1"
    assert len(body["safetyPrompts"]) == 22


def test_create_blocked_on_missing_consent(client: TestClient) -> None:
    response = client.post(BASE, json={"role": "adult", "consentGiven": False, "ageYears": 30})
    assert response.status_code == 200
    body = response.json()
    assert body["allowed"] is False
    assert body["reason"] == "consent_required"
    assert body["sessionId"] is None


def test_create_blocked_on_professional_identifiable_data(client: TestClient) -> None:
    response = client.post(
        BASE,
        json={
            "role": "professional",
            "consentGiven": True,
            "professionalConfirmed": True,
            "containsIdentifiableData": True,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["allowed"] is False
    assert body["reason"] == "privacy_block"


def test_answer_on_unknown_session_is_404(client: TestClient) -> None:
    response = client.post(
        f"{BASE}/does-not-exist/answers", json={"kind": "complaint", "name": "ronquido"}
    )
    assert response.status_code == 404


def test_reads_on_unknown_session_are_404(client: TestClient) -> None:
    assert client.get(f"{BASE}/nope/summary").status_code == 404
    assert client.post(f"{BASE}/nope/claim-token").status_code == 404
    assert client.get(f"{BASE}/nope/snapshot").status_code == 404


def test_reused_token_is_rejected_over_http(client: TestClient) -> None:
    session_id = _create_adult(client)
    token = client.post(f"{BASE}/{session_id}/claim-token").json()["token"]

    first = client.post(f"{BASE}/claim", json={"token": token}, headers={"X-Somnus-Actor-Id": "u1"})
    assert first.json()["success"] is True

    second = client.post(
        f"{BASE}/claim", json={"token": token}, headers={"X-Somnus-Actor-Id": "u2"}
    )
    assert second.json()["success"] is False
    assert second.json()["reason"] == "already_claimed_or_expired"


def test_claim_requires_the_edge_injected_actor_header(client: TestClient) -> None:
    session_id = _create_adult(client)
    token = client.post(f"{BASE}/{session_id}/claim-token").json()["token"]
    response = client.post(f"{BASE}/claim", json={"token": token})  # no actor header
    assert response.status_code == 422


def test_urgent_base_orientation_is_rejected_by_validation(client: TestClient) -> None:
    response = client.post(
        BASE, json={"role": "adult", "consentGiven": True, "baseOrientation": "L1"}
    )
    assert response.status_code == 422
