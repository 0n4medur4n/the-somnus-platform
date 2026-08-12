"""e2e-style tests per build plan §20 Checkpoint 4.1: the app boots, health
and version endpoints respond as documented, and correlation IDs propagate.
Uses httpx.AsyncClient over an in-process ASGI transport (no real socket).
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from morpheo.main import create_app
from morpheo.settings.config import Settings


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        service_name="morpheo-service",
        service_version="test",
        service_commit="test-sha",
        env="test",
    )


async def test_health_live_returns_ok(settings: Settings) -> None:
    app = create_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health/live")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


async def test_health_ready_returns_ready(settings: Settings) -> None:
    app = create_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health/ready")
    assert res.status_code == 200
    assert res.json() == {"status": "ready"}


async def test_version_reports_service_identity(settings: Settings) -> None:
    app = create_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/version")
    assert res.status_code == 200
    body = res.json()
    assert body["service"] == "morpheo-service"
    assert body["version"] == "test"
    assert body["commit"] == "test-sha"
    assert body["env"] == "test"
    assert isinstance(body["python"], str) and body["python"]


async def test_correlation_id_is_generated_when_missing(settings: Settings) -> None:
    app = create_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health/live")
    assert "x-correlation-id" in res.headers
    assert len(res.headers["x-correlation-id"]) > 0


async def test_correlation_id_is_echoed_back_when_valid(settings: Settings) -> None:
    app = create_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health/live", headers={"x-correlation-id": "abc-123"})
    assert res.headers["x-correlation-id"] == "abc-123"


async def test_correlation_id_is_replaced_when_malformed(settings: Settings) -> None:
    app = create_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health/live", headers={"x-correlation-id": "has a space"})
    assert res.headers["x-correlation-id"] != "has a space"
