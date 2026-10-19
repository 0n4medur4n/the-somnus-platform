"""Who answers the extraction request: OpenAI, recorded outputs, or nobody.

The OpenAI SDK is imported lazily, so the service boots and the tests run
without it being loaded. Every call: `store=False`, a short timeout, no
retries (a failed call falls back to asking the questions, never blocks),
structured output with the strict JSON schema, and the model from config.

`FixtureProvider` replays outputs recorded with `python -m morpheo.ai.record`
(keyed by prompt version and the pseudonymised text), so CI never calls a
model. A text without a recording is a failed call: the interview then asks
every question, as it would if OpenAI were down.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol, cast

if TYPE_CHECKING:
    from openai.types.chat import ChatCompletionMessageParam
    from openai.types.shared import ReasoningEffort
    from openai.types.shared_params import ResponseFormatJSONSchema

DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
EU_OPENAI_BASE_URL = "https://eu.api.openai.com/v1"


class ProviderError(RuntimeError):
    """The call did not return a usable answer (the code says why)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ModelRequest:
    system: str
    user: str
    schema: dict[str, Any]
    schema_name: str
    # The pseudonymised text and prompt version: what a recording is keyed on.
    text: str
    prompt_version: str


@dataclass(frozen=True)
class ModelReply:
    text: str
    model: str


class Provider(Protocol):
    @property
    def model(self) -> str: ...

    @property
    def region(self) -> str: ...

    def complete(self, request: ModelRequest) -> ModelReply: ...


def region_of(base_url: str) -> str:
    """Where OpenAI processes the call: "eu" for the EU data-residency endpoint."""
    return "eu" if base_url.rstrip("/") == EU_OPENAI_BASE_URL else "us"


def recording_key(prompt_version: str, text: str) -> str:
    return hashlib.sha256(f"{prompt_version}\n{text}".encode()).hexdigest()


class OpenAiProvider:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str,
        timeout_seconds: float,
        reasoning_effort: str,
        temperature: float,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._base_url = base_url
        self._timeout = timeout_seconds
        self._effort = reasoning_effort
        self._temperature = temperature

    @property
    def model(self) -> str:
        return self._model

    @property
    def region(self) -> str:
        return region_of(self._base_url)

    def complete(self, request: ModelRequest) -> ModelReply:
        import openai
        from openai import OpenAI

        client = OpenAI(
            api_key=self._api_key,
            base_url=self._base_url,
            timeout=self._timeout,
            max_retries=0,
        )
        messages: list[ChatCompletionMessageParam] = [
            {"role": "system", "content": request.system},
            {"role": "user", "content": request.user},
        ]
        response_format: ResponseFormatJSONSchema = {
            "type": "json_schema",
            "json_schema": {"name": request.schema_name, "strict": True, "schema": request.schema},
        }
        try:
            # store=False on every call: the completion is not kept in the
            # OpenAI platform. With reasoning on, OpenAI rejects sampling
            # parameters, so the temperature goes only with effort "none".
            if self._effort != "none":
                completion = client.chat.completions.create(
                    model=self._model,
                    reasoning_effort=cast("ReasoningEffort", self._effort),
                    messages=messages,
                    response_format=response_format,
                    store=False,
                )
            else:
                completion = client.chat.completions.create(
                    model=self._model,
                    reasoning_effort="none",
                    temperature=self._temperature,
                    messages=messages,
                    response_format=response_format,
                    store=False,
                )
        except openai.APITimeoutError as exc:
            raise ProviderError("timeout") from exc
        except openai.OpenAIError as exc:
            raise ProviderError("provider_error") from exc
        choice = completion.choices[0].message
        if getattr(choice, "refusal", None):
            raise ProviderError("refused")
        return ModelReply(text=choice.content or "", model=completion.model)


class FixtureProvider:
    """Replays recorded outputs; never touches the network."""

    def __init__(self, recordings: dict[str, Any], model: str = "fixture") -> None:
        self._recordings = recordings
        self._model = model

    @staticmethod
    def from_file(path: Path) -> FixtureProvider:
        data = json.loads(path.read_text(encoding="utf-8"))
        return FixtureProvider(data["recordings"], data.get("model", "fixture"))

    @property
    def model(self) -> str:
        return self._model

    @property
    def region(self) -> str:
        return "fixture"

    def complete(self, request: ModelRequest) -> ModelReply:
        entry = self._recordings.get(recording_key(request.prompt_version, request.text))
        if entry is None:
            raise ProviderError("no_recording")
        output = entry["output"]
        return ModelReply(
            text=output if isinstance(output, str) else json.dumps(output, ensure_ascii=False),
            model=entry.get("model", self._model),
        )


class FailingProvider:
    """Every call fails (tests: OpenAI down or timing out)."""

    def __init__(self, code: str = "timeout") -> None:
        self._code = code

    @property
    def model(self) -> str:
        return "unavailable"

    @property
    def region(self) -> str:
        return "none"

    def complete(self, request: ModelRequest) -> ModelReply:
        raise ProviderError(self._code)


__all__ = [
    "DEFAULT_OPENAI_BASE_URL",
    "EU_OPENAI_BASE_URL",
    "FailingProvider",
    "FixtureProvider",
    "ModelReply",
    "ModelRequest",
    "OpenAiProvider",
    "Provider",
    "ProviderError",
    "recording_key",
    "region_of",
]
