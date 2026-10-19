"""One free text through the AI: what is sent, what is kept, what is audited."""

from __future__ import annotations

import json
import logging
from typing import Any

import pytest

from morpheo.ai.audit import sha256
from morpheo.ai.pipeline import AiExtractor, purpose_of, run, settled_ids
from morpheo.ai.prompts import PROMPT_VERSION, response_schema
from morpheo.ai.provider import (
    FailingProvider,
    FixtureProvider,
    ModelReply,
    ModelRequest,
    recording_key,
)
from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.extraction import all_targets
from morpheo.funnel.interview import Answer

A = funnel_artifact()
RISK_NO = {"S1": "no", "S4": "no", "S2": "no"}


class Scripted:
    """Answers every call with one output, and keeps the requests it saw."""

    def __init__(self, output: Any) -> None:
        self.output = output
        self.requests: list[ModelRequest] = []

    @property
    def model(self) -> str:
        return "test-model"

    @property
    def region(self) -> str:
        return "eu"

    def complete(self, request: ModelRequest) -> ModelReply:
        self.requests.append(request)
        text = self.output if isinstance(self.output, str) else json.dumps(self.output)
        return ModelReply(text, "test-model")


def _run(text: str, provider: Any, answers: dict[str, Answer] | None = None, source: str = "Q01"):
    return run(A, answers or {}, source_key=source, text=text, provider=provider, extract=True)


def test_the_model_sees_markers_and_the_record_gets_the_persons_words_back() -> None:
    text = "Mi mujer Marta dice que dejo de respirar desde hace seis meses."
    provider = Scripted(
        {
            "items": [
                {
                    "id": "Q15",
                    "value": ["dejar_de_respirar"],
                    "evidence": "Mi mujer [PERSONA_1] dice que dejo de respirar",
                },
                {
                    "id": "Q03",
                    "value": {"amount": 6, "unit": "meses"},
                    "evidence": "desde hace seis meses",
                },
            ],
            "risk": RISK_NO,
        }
    )
    call = _run(text, provider)
    sent = provider.requests[0]
    assert "Marta" not in sent.user and "Marta" not in sent.text
    assert call.record.status == "ok"
    assert [i.evidence for i in call.record.items] == [
        "Mi mujer Marta dice que dejo de respirar",
        "desde hace seis meses",
    ]
    assert call.record.items[1].value == {"value": 6, "unit": "meses"}
    assert call.event.pseudonymised_count == 1


@pytest.mark.parametrize(
    ("item", "why"),
    [
        (
            {"id": "Q03", "value": {"amount": 6, "unit": "meses"}, "evidence": "seis meses atrás"},
            "not in text",
        ),
        ({"id": "Q11", "value": "dormido", "evidence": "me duermo"}, "not an option"),
        ({"id": "S4", "value": "si", "evidence": "me duermo"}, "safety is never extracted"),
        ({"id": "Q05", "value": 9, "evidence": "me duermo"}, "out of range"),
        ({"id": "Q15", "value": [], "evidence": "me duermo"}, "empty list"),
        ({"id": "Q03", "value": "seis meses", "evidence": "me duermo"}, "wrong shape"),
        ({"id": "Q03", "value": {"amount": 6, "unit": "meses"}}, "no evidence"),
        ({"id": "Q14.opioides", "value": "no", "evidence": "me duermo"}, "a flag is only «si»"),
    ],
)
def test_anything_outside_the_schema_or_the_text_is_discarded(
    item: dict[str, Any], why: str
) -> None:
    call = _run("Casi siempre me duermo tarde.", Scripted({"items": [item], "risk": RISK_NO}))
    assert call.record.status == "ok", why
    assert call.record.items == (), why
    assert call.record.discarded == 1, why


@pytest.mark.parametrize(
    "output",
    [
        "not json",
        {"items": []},
        {"items": [], "risk": {"S1": "no", "S4": "no"}},
        {"items": [], "risk": {"S1": "quizá", "S4": "no", "S2": "no"}},
        {"items": {}, "risk": RISK_NO},
    ],
)
def test_an_envelope_out_of_schema_is_a_failed_call(output: Any) -> None:
    call = _run("Me duermo tarde.", Scripted(output))
    assert call.record.status == "failed"
    assert call.record.items == () and call.record.risk == {}
    assert call.event.status == "out_of_schema"


def test_a_failing_provider_never_raises_and_leaves_a_failed_record() -> None:
    call = _run("Me duermo tarde.", FailingProvider("timeout"))
    assert call.record.status == "failed"
    assert call.event.status == "timeout"
    assert call.event.output_hash is None


def test_an_unexpected_error_is_a_failed_call_too() -> None:
    class Broken(Scripted):
        def complete(self, request: ModelRequest) -> ModelReply:
            raise RuntimeError("boom")

    assert _run("Me duermo tarde.", Broken(None)).event.status == "provider_error"


def test_what_is_already_answered_or_proposed_is_not_asked_again() -> None:
    answers = {
        "Q01": Answer(value="x", text="x"),
        "Q01#ia": Answer(
            value={
                "source": "Q01",
                "status": "ok",
                "items": [{"id": "Q08", "value": ["dormirse"], "evidence": "x"}],
                "risk": RISK_NO,
            }
        ),
        "Q03": Answer(value={"value": 2, "unit": "años"}),
    }
    settled = settled_ids(A, answers)
    assert {"Q01", "Q03", "Q08"} <= settled
    provider = Scripted({"items": [], "risk": RISK_NO})
    _run("Me duermo tarde.", provider, answers, source="Q02")
    asked = json.dumps(provider.requests[0].schema)
    assert '"Q03"' not in asked and '"Q08"' not in asked and '"Q05"' in asked


def test_z2_is_only_screened_and_other_steps_call_nothing() -> None:
    assert purpose_of("Z2") == "cribado"
    assert purpose_of("Q01") == "extraccion"
    assert purpose_of("Q03") is None
    extractor = AiExtractor(Scripted({"items": [], "risk": RISK_NO}))
    assert extractor.process(A, {}, "Q03", "algo") is None
    assert extractor.process(A, {}, "Q01", "   ") is None


def test_the_audit_event_carries_hashes_and_counts_never_the_text(
    caplog: pytest.LogCaptureFixture,
) -> None:
    text = "Mi mujer Marta dice que ronco muchísimo."
    provider = Scripted({"items": [], "risk": RISK_NO})
    # Alembic's fileConfig (integration tests) disables existing loggers.
    logging.getLogger("morpheo.ai.audit").disabled = False
    with caplog.at_level(logging.INFO, logger="morpheo.ai.audit"):
        AiExtractor(provider).process(A, {}, "Q01", text)
    [line] = [r for r in caplog.records if r.name == "morpheo.ai.audit"]
    event = line.aiCall  # type: ignore[attr-defined]
    assert event["event"] == "ai.call"
    assert set(event) == {
        "event",
        "purpose",
        "model",
        "prompt_version",
        "region",
        "status",
        "input_hash",
        "output_hash",
        "pseudonymised_count",
        "items",
        "discarded",
        "latency_ms",
        "at",
    }
    assert event["prompt_version"] == PROMPT_VERSION and event["region"] == "eu"
    assert event["output_hash"] == sha256(json.dumps({"items": [], "risk": RISK_NO}))
    dumped = json.dumps(event, ensure_ascii=False)
    assert "Marta" not in dumped and "ronco" not in dumped


def test_recordings_replay_by_prompt_version_and_pseudonymised_text() -> None:
    text = "Me cuesta mucho dormirme."
    output = {
        "items": [{"id": "Q08", "value": ["dormirse"], "evidence": text[:-1]}],
        "risk": RISK_NO,
    }
    fixture = FixtureProvider({recording_key(PROMPT_VERSION, text): {"output": output}})
    assert _run(text, fixture).record.items[0].value == ["dormirse"]
    assert _run("Otro texto.", fixture).record.status == "failed"


def test_the_response_schema_is_strict_everywhere() -> None:
    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object":
                assert node["additionalProperties"] is False
                assert set(node["required"]) == set(node["properties"])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(response_schema(all_targets(A)))
    walk(response_schema(()))
