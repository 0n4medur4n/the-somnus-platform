"""OpenAI embedding adapter (build plan §3.6b: text-embedding-3-large, 3072-dim).

The OpenAI SDK is imported lazily so the service boots (and tests run) without a
key or the SDK loaded; in tests the provider is mocked and this adapter is never
called. It only embeds the approved corpus/query terms and returns vectors — no
business logic, and never on the clinical decision path (§14b).
"""

from __future__ import annotations

from report.infrastructure.llm.provider import EmbeddingRequest, EmbeddingResponse


class OpenAiEmbeddingAdapter:
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        from openai import OpenAI

        client = OpenAI(api_key=self._api_key)
        response = client.embeddings.create(
            model=request.model,
            input=request.inputs,
            dimensions=request.dimensions,
        )
        vectors = [list(item.embedding) for item in response.data]
        return EmbeddingResponse(vectors=vectors, model=response.model)
