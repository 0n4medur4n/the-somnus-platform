"""Which OpenAI endpoint the service uses, and that it says so at startup."""

from __future__ import annotations

import logging
from types import SimpleNamespace
from typing import Any

import pytest

from report.infrastructure.llm.openai_adapter import OpenAiAdapter
from report.infrastructure.llm.openai_endpoint import (
    DEFAULT_OPENAI_BASE_URL,
    endpoint_line,
    openai_base_url,
)
from report.infrastructure.llm.provider import LlmRequest


def test_the_default_endpoint_is_openai_s_global_one(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    assert openai_base_url() == DEFAULT_OPENAI_BASE_URL == "https://api.openai.com/v1"


def test_an_eu_residency_endpoint_is_used_by_the_calls_and_named_by_the_log(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_BASE_URL", "https://eu.api.openai.com/v1")
    used: dict[str, Any] = {}

    class _Completions:
        def create(self, **kwargs: Any) -> Any:
            message = SimpleNamespace(content="ok")
            return SimpleNamespace(model="gpt-6-luna", choices=[SimpleNamespace(message=message)])

    class _Client:
        def __init__(self, api_key: str, base_url: str) -> None:
            used["base_url"] = base_url
            self.chat = SimpleNamespace(completions=_Completions())

    import openai

    monkeypatch.setattr(openai, "OpenAI", _Client)
    OpenAiAdapter(api_key="k").complete(LlmRequest(system="s", user="u", model="m", temperature=0))

    assert used["base_url"] == "https://eu.api.openai.com/v1"
    assert endpoint_line(enabled=True) == "OpenAI API base URL in use: https://eu.api.openai.com/v1"


def test_without_a_key_the_line_says_no_model_is_called() -> None:
    assert "no model calls" in endpoint_line(enabled=False)


class _Lines(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append(record.getMessage())


def test_the_service_logs_the_endpoint_at_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    from report.main import create_app
    from report.settings.config import Settings

    # A handler on the logger itself: independent of where the service's JSON
    # handler writes. Re-enabled for the test because Alembic's fileConfig (run
    # by the integration tests' migrations) disables loggers that already exist.
    lines = _Lines()
    logger = logging.getLogger("report.llm")
    previous = (logger.level, logger.disabled)
    logger.addHandler(lines)
    logger.setLevel(logging.INFO)
    logger.disabled = False
    try:
        create_app(Settings(OPENAI_API_KEY="test-key"))
    finally:
        logger.removeHandler(lines)
        logger.setLevel(previous[0])
        logger.disabled = previous[1]

    assert "OpenAI API base URL in use: https://api.openai.com/v1" in lines.lines
    # The URL, never the key.
    assert not any("test-key" in line for line in lines.lines)
