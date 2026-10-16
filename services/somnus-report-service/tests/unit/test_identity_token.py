"""Calls to private Morpheo carry an ID token on Cloud Run, nothing elsewhere."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from report.infrastructure.identity_token import IdentityHeaders
from report.infrastructure.morpheo_client import MorpheoContentClient


def test_off_cloud_run_nothing_is_attached() -> None:
    def _never(audience: str) -> str:
        raise AssertionError("no metadata server off Cloud Run")

    assert IdentityHeaders(fetch=_never, enabled=False)("https://morpheo") == {}


def test_on_cloud_run_a_token_for_the_callee_is_attached_and_reused() -> None:
    asked: list[str] = []

    def _fetch(audience: str) -> str:
        asked.append(audience)
        return "id-token-1"

    headers = IdentityHeaders(fetch=_fetch, enabled=True)
    assert headers("https://morpheo") == {"Authorization": "Bearer id-token-1"}
    assert headers("https://morpheo") == {"Authorization": "Bearer id-token-1"}
    assert asked == ["https://morpheo"]


def test_the_content_client_sends_the_token_for_morpheos_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    def _get(url: str, **kwargs: Any) -> httpx.Response:
        captured["url"] = url
        captured["headers"] = kwargs.get("headers")
        return httpx.Response(500, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", _get)
    client = MorpheoContentClient(
        "https://morpheo.run.app/", auth=lambda audience: {"Authorization": f"Bearer {audience}"}
    )
    with pytest.raises(httpx.HTTPStatusError):
        client.get_content()
    assert captured["url"] == "https://morpheo.run.app/internal/v1/assessments/content"
    assert captured["headers"] == {"Authorization": "Bearer https://morpheo.run.app"}
