"""The LLM provider abstraction + §15 audit (build plan §15 / Checkpoint 11.2)."""

from __future__ import annotations

from dataclasses import asdict
from types import SimpleNamespace
from typing import Any

import pytest

from report.infrastructure.llm.audit import build_audit
from report.infrastructure.llm.openai_adapter import OpenAiAdapter
from report.infrastructure.llm.provider import LlmProvider, LlmRequest, LlmResponse


class _FakeProvider:
    def complete(self, request: LlmRequest) -> LlmResponse:
        return LlmResponse(text="ok", model=request.model)


def test_provider_protocol_accepts_an_implementation() -> None:
    provider: LlmProvider = _FakeProvider()
    assert (
        provider.complete(LlmRequest(system="s", user="u", model="m", temperature=0.1)).text == "ok"
    )


def test_openai_adapter_forwards_the_prompt_and_maps_the_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    class _Completions:
        def create(self, **kwargs: Any) -> Any:
            captured.update(kwargs)
            message = SimpleNamespace(content="Texto reescrito.")
            return SimpleNamespace(model="gpt-5.6", choices=[SimpleNamespace(message=message)])

    class _Client:
        def __init__(self, api_key: str) -> None:
            captured["api_key"] = api_key
            self.chat = SimpleNamespace(completions=_Completions())

    import openai

    monkeypatch.setattr(openai, "OpenAI", _Client)
    response = OpenAiAdapter(api_key="secret").complete(
        LlmRequest(system="Eres un asistente.", user="Reescribe.", model="gpt-5.6", temperature=0.2)
    )

    assert response.text == "Texto reescrito."
    assert response.model == "gpt-5.6"
    assert captured["model"] == "gpt-5.6"
    assert captured["temperature"] == 0.2
    assert captured["api_key"] == "secret"


def test_audit_carries_only_hashes_never_raw_health_text() -> None:
    raw_input = "El paciente comunica somnolencia diurna y despertares nocturnos."
    raw_response = "Conviene que valores tu sueño con un profesional."
    audit = build_audit(
        model="gpt-5.6",
        template_version="report_v1",
        prompt_template_id="rewrite_v1",
        structured_input=raw_input,
        response_text=raw_response,
        review_status="pending_review",
    )

    assert len(audit.input_hash) == 64
    assert len(audit.response_hash) == 64
    assert audit.review_status == "pending_review"
    # The record must never carry the raw text — only hashes (§15).
    dumped = str(asdict(audit))
    assert raw_input not in dumped
    assert raw_response not in dumped
