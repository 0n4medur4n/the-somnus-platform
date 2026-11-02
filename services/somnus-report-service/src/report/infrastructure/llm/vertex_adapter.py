"""Gemini on Vertex AI, an adapter for the LLM provider abstraction (build plan §3.6).

The EU option the plan names: the model runs in our own Google Cloud project, in
the region we choose, reached with the service's own identity from the metadata
server -- no key. It only forwards a prompt and returns text; no business logic.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx

from report.infrastructure.llm.provider import LlmRequest, LlmResponse

METADATA_TOKEN_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
)


def metadata_token() -> str:
    """The Cloud Run service account's access token."""
    response = httpx.get(METADATA_TOKEN_URL, headers={"Metadata-Flavor": "Google"}, timeout=5.0)
    response.raise_for_status()
    token = response.json().get("access_token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("metadata server returned no token")
    return token


class VertexGeminiAdapter:
    def __init__(
        self,
        project: str,
        location: str,
        token: Callable[[], str] = metadata_token,
        client: httpx.Client | None = None,
        timeout: float = 40.0,
    ) -> None:
        self._project = project
        self._location = location
        self._token = token
        self._client = client
        self._timeout = timeout

    def complete(self, request: LlmRequest) -> LlmResponse:
        url = (
            f"https://{self._location}-aiplatform.googleapis.com/v1/projects/{self._project}"
            f"/locations/{self._location}/publishers/google/models/{request.model}:generateContent"
        )
        generation: dict[str, Any] = {"temperature": request.temperature}
        if request.json_output:
            generation["responseMimeType"] = "application/json"
        body = {
            "systemInstruction": {"parts": [{"text": request.system}]},
            "contents": [{"role": "user", "parts": [{"text": request.user}]}],
            "generationConfig": generation,
        }
        headers = {"Authorization": f"Bearer {self._token()}"}
        if self._client is not None:
            response = self._client.post(url, json=body, headers=headers, timeout=self._timeout)
        else:
            response = httpx.post(url, json=body, headers=headers, timeout=self._timeout)
        # The status only: the body could echo the text, which is never logged.
        if response.status_code >= 400:
            raise RuntimeError(f"Vertex AI refused: {response.status_code}")
        payload = response.json()
        candidates = payload.get("candidates") or []
        parts = (candidates[0].get("content") or {}).get("parts") or [] if candidates else []
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
        return LlmResponse(text=text, model=str(payload.get("modelVersion") or request.model))
