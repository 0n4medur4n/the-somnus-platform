"""The report render endpoint (build plan §20 Checkpoint 11.1)."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from report.application.render_service import RenderService
from report.infrastructure.storage import LocalStorageBackend
from report.main import create_app
from report.schemas.render import ClinicalContentDTO
from report.settings.config import Settings


class _FakeContent:
    def __init__(self, content: ClinicalContentDTO) -> None:
        self._content = content

    def get_content(self) -> ClinicalContentDTO:
        return self._content


class _FakePdf:
    def to_pdf(self, html: str) -> bytes:
        return b"%PDF-1.7 fake"


@pytest.fixture
def client(tmp_path: Path, content: ClinicalContentDTO) -> Iterator[TestClient]:
    app = create_app(Settings(service_name="somnus-report-service", env="test"))
    app.state.render_service = RenderService(
        content_provider=_FakeContent(content),
        pdf_renderer=_FakePdf(),
        storage=LocalStorageBackend(root=tmp_path, base_url="http://127.0.0.1:8081/reports"),
        signed_url_ttl=timedelta(minutes=15),
    )
    with TestClient(app) as test_client:
        yield test_client


def test_render_endpoint_returns_a_signed_report_ref(client: TestClient) -> None:
    body = {
        "assessmentId": "a1",
        "definitionVersion": "1.0",
        "contentVersion": "1.2",
        "locale": "es",
        "role": "adult",
        "level": "L4",
        "stop": False,
        "triggeredRules": [],
        "routes": ["INS"],
        "completedAt": "2026-08-18T10:00:00Z",
    }
    response = client.post("/internal/v1/reports", json=body)
    assert response.status_code == 200
    ref = response.json()
    assert ref["reportId"]
    assert ref["assessmentId"] == "a1"
    assert ref["templateVersion"] == "report_v1"
    assert ref["htmlUrl"].endswith(".html") is False  # carries the signed query
    assert "expires=" in ref["htmlUrl"]
    assert "expires=" in ref["pdfUrl"]


def test_render_endpoint_rejects_an_unknown_module(client: TestClient) -> None:
    body = {
        "assessmentId": "a1",
        "definitionVersion": "1.0",
        "contentVersion": "1.2",
        "locale": "es",
        "role": "adult",
        "level": "L4",
        "stop": False,
        "triggeredRules": [],
        "routes": ["ZZZ"],
        "completedAt": "2026-08-18T10:00:00Z",
    }
    assert client.post("/internal/v1/reports", json=body).status_code == 422
