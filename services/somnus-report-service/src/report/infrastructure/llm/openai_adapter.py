"""OpenAI adapter for the LLM provider abstraction (build plan §15).

The OpenAI SDK is imported lazily so the service boots (and tests run) without a
key or the SDK loaded; in tests the provider is mocked and this adapter is never
called. It only forwards a prompt and returns text — no business logic here.
"""

from __future__ import annotations

from report.infrastructure.llm.provider import LlmRequest, LlmResponse


class OpenAiAdapter:
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    def complete(self, request: LlmRequest) -> LlmResponse:
        from openai import OpenAI

        client = OpenAI(api_key=self._api_key)
        completion = client.chat.completions.create(
            model=request.model,
            temperature=request.temperature,
            messages=[
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.user},
            ],
        )
        text = completion.choices[0].message.content or ""
        return LlmResponse(text=text, model=completion.model)
