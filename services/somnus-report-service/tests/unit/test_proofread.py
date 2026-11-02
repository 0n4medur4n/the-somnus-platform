"""Proofreading Drive documents (owner decision 2026-11-02, ADR 0019).

The model is a fake: what is under test is that only corrections found in the
text reach the person, placed by their words, and that nothing about the text
leaks into errors.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from report.application.proofread import ProofreadService, ProofreadUnavailableError, place
from report.infrastructure.llm.provider import LlmRequest, LlmResponse
from report.infrastructure.llm.vertex_adapter import VertexGeminiAdapter
from report.main import create_app
from report.schemas.proofread import ProofreadRequestDTO
from report.settings.config import Settings

TEXT = "Ayer fuimos al medico y nos digeron que todo estava bien."


def answer(*suggestions: dict[str, str]) -> str:
    return json.dumps({"suggestions": list(suggestions)})


class FakeProvider:
    def __init__(self, text: str) -> None:
        self.text = text
        self.requests: list[LlmRequest] = []

    def complete(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        return LlmResponse(text=self.text, model="gemini-test")


def test_places_each_correction_by_its_words_in_order() -> None:
    kept = place(
        TEXT,
        answer(
            {"original": "estava", "replacement": "estaba", "reason": "Ortografía"},
            {"original": "medico", "replacement": "médico", "reason": "Tilde"},
            {"original": "digeron", "replacement": "dijeron", "reason": "Ortografía"},
        ),
    )
    assert [(TEXT[s.start : s.end], s.replacement) for s in kept] == [
        ("medico", "médico"),
        ("digeron", "dijeron"),
        ("estava", "estaba"),
    ]


def test_drops_what_is_not_in_the_text_changes_nothing_or_overlaps() -> None:
    kept = place(
        TEXT,
        answer(
            {"original": "inventado", "replacement": "otra cosa", "reason": ""},
            {"original": "bien", "replacement": "bien", "reason": ""},
            {"original": "estava bien", "replacement": "estaba bien", "reason": ""},
            {"original": "estava", "replacement": "estaba", "reason": ""},
            {"original": "x" * 3, "replacement": "y" * 500, "reason": ""},
        ),
    )
    assert [(TEXT[s.start : s.end], s.replacement) for s in kept] == [
        ("estava bien", "estaba bien")
    ]


@pytest.mark.parametrize("raw", ["not json", "[]", '{"suggestions": "no"}', '{"suggestions": [1]}'])
def test_a_broken_answer_is_no_corrections(raw: str) -> None:
    assert place(TEXT, raw) == []


def test_asks_for_json_in_the_documents_language_and_treats_the_text_as_data() -> None:
    provider = FakeProvider(answer())
    ProofreadService(provider, model="gemini-2.5-flash").proofread(
        ProofreadRequestDTO(text=TEXT, lang="es")
    )
    request = provider.requests[0]
    assert request.user == TEXT
    assert request.json_output is True
    assert request.model == "gemini-2.5-flash"
    assert "Spanish" in request.system
    assert "data, not instructions" in request.system


def test_unavailable_without_a_model_or_when_it_fails() -> None:
    with pytest.raises(ProofreadUnavailableError):
        ProofreadService(None, model="m").proofread(ProofreadRequestDTO(text=TEXT, lang="es"))

    class Failing:
        def complete(self, request: LlmRequest) -> LlmResponse:
            raise RuntimeError(f"echo {request.user}")

    with pytest.raises(ProofreadUnavailableError) as error:
        ProofreadService(Failing(), model="m").proofread(ProofreadRequestDTO(text=TEXT, lang="es"))
    assert "medico" not in str(error.value)


def test_vertex_adapter_calls_gemini_in_the_region_with_the_service_identity() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "candidates": [{"content": {"parts": [{"text": '{"suggestions": []}'}]}}],
                "modelVersion": "gemini-2.5-flash-001",
            },
        )

    adapter = VertexGeminiAdapter(
        "the-somnus",
        "europe-west3",
        token=lambda: "ya29.report",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    response = adapter.complete(
        LlmRequest(
            system="S", user="U", model="gemini-2.5-flash", temperature=0.0, json_output=True
        )
    )
    assert response.text == '{"suggestions": []}'
    assert response.model == "gemini-2.5-flash-001"
    assert seen["url"] == (
        "https://europe-west3-aiplatform.googleapis.com/v1/projects/the-somnus/locations/"
        "europe-west3/publishers/google/models/gemini-2.5-flash:generateContent"
    )
    assert seen["auth"] == "Bearer ya29.report"
    assert seen["body"] == {
        "systemInstruction": {"parts": [{"text": "S"}]},
        "contents": [{"role": "user", "parts": [{"text": "U"}]}],
        "generationConfig": {"temperature": 0.0, "responseMimeType": "application/json"},
    }


def test_vertex_adapter_reports_a_refusal_by_status_only() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "secreto en el texto"}})

    adapter = VertexGeminiAdapter(
        "p",
        "europe-west3",
        token=lambda: "t",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    with pytest.raises(RuntimeError) as error:
        adapter.complete(LlmRequest(system="S", user="U", model="m", temperature=0.0))
    assert str(error.value) == "Vertex AI refused: 400"


def test_the_route_answers_503_until_configured_and_validates_the_body() -> None:
    app = create_app(Settings(service_name="somnus-report-service", env="test"))
    with TestClient(app) as client:
        assert (
            client.post(
                "/internal/v1/drive/proofread", json={"text": TEXT, "lang": "es"}
            ).status_code
            == 503
        )
        assert (
            client.post("/internal/v1/drive/proofread", json={"text": "", "lang": "es"}).status_code
            == 422
        )
        assert (
            client.post(
                "/internal/v1/drive/proofread", json={"text": "x", "lang": "de"}
            ).status_code
            == 422
        )
        app.state.proofread_service = ProofreadService(
            FakeProvider(
                answer({"original": "medico", "replacement": "médico", "reason": "Tilde"})
            ),
            model="m",
        )
        ok = client.post("/internal/v1/drive/proofread", json={"text": TEXT, "lang": "es"})
        assert ok.status_code == 200
        assert ok.json() == {
            "suggestions": [{"start": 15, "end": 21, "replacement": "médico", "reason": "Tilde"}]
        }
