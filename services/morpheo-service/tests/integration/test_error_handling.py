"""Proves the "no production stack traces" behavioral rule (build plan §20
Phase 3, carried into Phase 4): an unhandled exception always maps to the
§16 error shape, and the real exception text only reaches the client
outside production.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from starlette.testclient import TestClient

from morpheo.main import create_app
from morpheo.settings.config import Settings

_SECRET_LOOKING_MESSAGE = "db password is hunter2"


def _client_for_env(env: str) -> Iterator[TestClient]:
    app = create_app(Settings(_env_file=None, env=env, service_version="test"))

    @app.get("/__test/boom")
    async def boom() -> None:
        raise RuntimeError(_SECRET_LOOKING_MESSAGE)

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def production_client() -> Iterator[TestClient]:
    yield from _client_for_env("production")


@pytest.fixture
def development_client() -> Iterator[TestClient]:
    yield from _client_for_env("development")


def test_unhandled_exception_hides_details_in_production(production_client: TestClient) -> None:
    res = production_client.get("/__test/boom")
    assert res.status_code == 500
    assert _SECRET_LOOKING_MESSAGE not in res.text

    body = res.json()
    assert body["error"]["code"] == "INTERNAL"
    assert body["error"]["message"] == "An unexpected error occurred."
    assert body["error"]["correlationId"]
    assert "x-correlation-id" in res.headers


def test_unhandled_exception_includes_detail_outside_production(
    development_client: TestClient,
) -> None:
    res = development_client.get("/__test/boom")
    body = res.json()
    assert _SECRET_LOOKING_MESSAGE in body["error"]["message"]
