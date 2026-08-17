"""The report service shell boots and answers health + version (build plan §5.6)."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from report.main import create_app
from report.settings.config import Settings


@pytest.fixture
def client() -> Iterator[TestClient]:
    settings = Settings(service_name="somnus-report-service", service_version="9.9.9", env="test")
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def test_liveness_and_readiness(client: TestClient) -> None:
    assert client.get("/health/live").json() == {"status": "ok"}
    assert client.get("/health/ready").json() == {"status": "ready"}


def test_version_reports_build_info(client: TestClient) -> None:
    body = client.get("/version").json()
    assert body["service"] == "somnus-report-service"
    assert body["version"] == "9.9.9"
    assert body["env"] == "test"


def test_correlation_id_is_echoed(client: TestClient) -> None:
    response = client.get("/health/live", headers={"x-correlation-id": "corr-report-1"})
    assert response.headers["x-correlation-id"] == "corr-report-1"
