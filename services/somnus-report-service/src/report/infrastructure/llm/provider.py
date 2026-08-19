"""The AI provider abstraction (build plan §3.6 / §3.6b / §5.6 / §15).

A single interface with provider adapters behind it (OpenAI first; Vertex/Gemini
later without touching business logic). Model, temperature, prompt-template
version, and embedding model/dimensions are configuration, never hardcoded at call
sites. The chat model only rewrites already-approved text (§15); the embedding
model is used only for explanation-only grounding, outside the decision path (§14b).
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


@dataclass(frozen=True)
class EmbeddingRequest:
    # Only ever the approved clinical corpus, or approved query terms — never PII
    # or health free-text (build plan §3.6b / §14b).
    inputs: list[str]
    model: str
    dimensions: int


@dataclass(frozen=True)
class EmbeddingResponse:
    vectors: list[list[float]]
    model: str


class EmbeddingProvider(Protocol):
    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse: ...
