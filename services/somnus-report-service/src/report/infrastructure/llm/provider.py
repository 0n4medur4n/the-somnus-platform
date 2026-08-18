"""The LLM provider abstraction (build plan §5.6 line 163 / §15).

A single interface with provider adapters behind it (OpenAI first; Vertex/Gemini
later without touching business logic). Model, temperature, and prompt-template
version are configuration, never hardcoded at call sites. The LLM only ever
rewrites already-approved text in plain language — it never decides anything (§15).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class LlmRequest:
    system: str
    user: str
    model: str
    temperature: float


@dataclass(frozen=True)
class LlmResponse:
    text: str
    model: str


class LlmProvider(Protocol):
    def complete(self, request: LlmRequest) -> LlmResponse: ...
