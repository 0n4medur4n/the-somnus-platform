"""OpenAI adapter for the LLM provider abstraction (build plan §15).

The OpenAI SDK is imported lazily so the service boots (and tests run) without a
key or the SDK loaded; in tests the provider is mocked and this adapter is never
called. It only forwards a prompt and returns text — no business logic here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from report.infrastructure.llm.provider import LlmRequest, LlmResponse

if TYPE_CHECKING:
    from openai import Omit
    from openai.types.chat import ChatCompletionMessageParam
    from openai.types.shared import ReasoningEffort
    from openai.types.shared_params import ResponseFormatJSONObject


class OpenAiAdapter:
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    def complete(self, request: LlmRequest) -> LlmResponse:
        from openai import OpenAI, omit

        client = OpenAI(api_key=self._api_key)
        messages: list[ChatCompletionMessageParam] = [
            {"role": "system", "content": request.system},
            {"role": "user", "content": request.user},
        ]
        effort = request.reasoning_effort
        response_format: ResponseFormatJSONObject | Omit = (
            {"type": "json_object"} if request.json_output else omit
        )
        if effort is not None and effort != "none":
            # Reasoning on: OpenAI rejects sampling parameters, so no temperature.
            completion = client.chat.completions.create(
                model=request.model,
                reasoning_effort=cast("ReasoningEffort", effort),
                messages=messages,
                response_format=response_format,
            )
        elif effort == "none":
            completion = client.chat.completions.create(
                model=request.model,
                reasoning_effort="none",
                temperature=request.temperature,
                messages=messages,
                response_format=response_format,
            )
        else:
            completion = client.chat.completions.create(
                model=request.model,
                temperature=request.temperature,
                messages=messages,
                response_format=response_format,
            )
        text = completion.choices[0].message.content or ""
        return LlmResponse(text=text, model=completion.model)
