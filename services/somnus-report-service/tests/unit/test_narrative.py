"""The person's AI-written report: what the model sees and what is done with it.

Owner decision 2026-10-16 (§15 amended): written live and shown without review.
These tests are the guardrails that make that acceptable.
"""

from __future__ import annotations

import json
from collections.abc import Callable

from report.application.narrative import NarrativeService, structured_input
from report.infrastructure.llm.provider import LlmRequest, LlmResponse
from report.rendering.renderer import render_html
from report.schemas.narrative import NarrativeDTO
from report.schemas.render import ClinicalContentDTO, ReportRenderRequestDTO, SafetyRuleContentDTO

RequestBuilder = Callable[..., ReportRenderRequestDTO]

GOOD = {
    "summary": "Nos has contado que te cuesta dormir. Conviene una consulta programada.",
    "whatToDo": ["Pide una consulta con tu médico de familia."],
    "patterns": [{"name": "Dificultad para dormir", "why": "Has descrito despertares."}],
    "recommendations": ["Lleva un diario de sueño de 14 días."],
    "prepare": ["Apunta desde cuándo te ocurre."],
}

GOOD_JSON = json.dumps(GOOD)


class _Model:
    def __init__(self, reply: str | Exception = GOOD_JSON) -> None:
        self.requests: list[LlmRequest] = []
        self._reply = reply

    def complete(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        if isinstance(self._reply, Exception):
            raise self._reply
        return LlmResponse(text=self._reply, model="gpt-6-luna")


class _Store:
    def __init__(self) -> None:
        self.rows: dict[tuple[str, str], NarrativeDTO] = {}

    def get(self, assessment_id: str, locale: str) -> NarrativeDTO | None:
        return self.rows.get((assessment_id, locale))

    def put(self, assessment_id: str, locale: str, narrative: NarrativeDTO, **_: object) -> None:
        self.rows.setdefault((assessment_id, locale), narrative)


def _service(model: _Model | None, store: _Store | None = None) -> NarrativeService:
    return NarrativeService(
        provider=model,
        store=store or _Store(),
        chat_model="gpt-6-luna",
        reasoning_effort="xhigh",
        temperature=0.2,
    )


def test_writes_once_then_serves_the_stored_report(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    model, store = _Model(), _Store()
    request = make_request(locale="es", level="L3", routes=("INS",))
    first = _service(model, store).for_assessment(request, content)
    again = _service(model, store).for_assessment(request, content)

    assert first.generated and first.narrative is not None
    assert first.narrative.what_to_do == GOOD["whatToDo"]
    assert again.narrative == first.narrative
    assert len(model.requests) == 1
    sent = model.requests[0]
    assert (sent.model, sent.reasoning_effort, sent.json_output) == ("gpt-6-luna", "xhigh", True)


def test_an_emergency_never_reaches_a_model(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    model = _Model()
    result = _service(model).for_assessment(make_request(level="L0", routes=()), content)
    assert result.generated is False
    assert model.requests == []


def test_the_model_sees_the_result_and_the_protocol_never_who(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    model = _Model()
    request = make_request(locale="es", level="L3", routes=("INS",))
    _service(model).for_assessment(request, content)
    sent = model.requests[0].user
    assert request.assessment_id not in sent
    data = json.loads(sent)
    assert set(data) == {"level", "urgentMessagesShownApart", "patterns", "limits"}
    # Morpheo's template quotes and [placeholders] never reach the model.
    summaries = [pattern["protocolSummary"] for pattern in data["patterns"]]
    assert summaries and all("[" not in s and "«" not in s for s in summaries)


def test_a_forbidden_phrase_discards_the_text_and_stores_nothing(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    store = _Store()
    bad = dict(GOOD, summary="Morpheo sustituye una consulta.")
    blocked = content.model_copy(update={"blocked_claims": ["Morpheo sustituye una consulta."]})
    result = _service(_Model(json.dumps(bad)), store).for_assessment(
        make_request(level="L3", routes=("INS",)), blocked
    )
    assert result.generated is False
    assert store.rows == {}


def test_malformed_or_failing_answers_fall_back_to_the_protocol(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    request = make_request(level="L3", routes=("INS",))
    for model in (_Model("not json"), _Model(json.dumps({"summary": "x"})), _Model(RuntimeError())):
        assert _service(model).for_assessment(request, content).generated is False
    assert _service(None).for_assessment(request, content).generated is False


def test_fired_rule_messages_are_given_as_shown_apart(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    with_rules = content.model_copy(
        update={
            "safety_rules": [
                SafetyRuleContentDTO(id="SAFE-003", level="L1", message="No conduzcas.")
            ]
        }
    )
    data = structured_input(
        make_request(level="L1", routes=("SLP",), triggered_rules=("SAFE-003",)), with_rules
    )
    assert data["urgentMessagesShownApart"] == ["No conduzcas."]


def test_the_pdf_prints_the_report_with_the_rules_own_words(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    with_rules = content.model_copy(
        update={
            "safety_rules": [
                SafetyRuleContentDTO(id="SAFE-007", level="L4", message="Pide una consulta.")
            ]
        }
    )
    html = render_html(
        make_request(locale="es", level="L4", routes=("INS",), triggered_rules=("SAFE-007",)),
        with_rules,
        narrative=NarrativeDTO.model_validate(GOOD),
    ).html
    assert "Lleva un diario de sueño de 14 días." in html
    assert "Apunta desde cuándo te ocurre." in html
    assert "Pide una consulta." in html
    # Presented as the report, without an "AI" label (owner decision 2026-10-17).
    assert "inteligencia artificial" not in html


class _Replies:
    """A model that answers from a script, one reply per call."""

    def __init__(self, *replies: str) -> None:
        self.requests: list[LlmRequest] = []
        self._replies = list(replies)

    def complete(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        return LlmResponse(text=self._replies.pop(0), model="gpt-6-luna")


def test_a_refused_answer_gets_one_corrected_retry_naming_only_the_rule(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    bad = json.dumps(dict(GOOD, summary="Tienes insomnio."))
    model = _Replies(bad, GOOD_JSON)
    service = NarrativeService(
        provider=model, store=_Store(), chat_model="m", reasoning_effort="xhigh", temperature=0.2
    )
    with_phrase = content.model_copy(
        update={
            "output_contract": content.output_contract.model_copy(
                update={"forbidden_phrases": ["Tienes [diagnóstico]."]}
            )
        }
    )
    result = service.for_assessment(make_request(level="L3", routes=("INS",)), with_phrase)

    assert result.generated is True
    assert len(model.requests) == 2
    retry = model.requests[1].user
    assert "Tienes [diagnóstico]." in retry
    # The refused text itself is never sent back.
    assert "Tienes insomnio." not in retry


def test_two_refusals_fall_back_to_the_protocol(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    model = _Replies("no json", "still no json")
    service = NarrativeService(
        provider=model, store=_Store(), chat_model="m", reasoning_effort="xhigh", temperature=0.2
    )
    result = service.for_assessment(make_request(level="L3", routes=("INS",)), content)
    assert result.generated is False
    assert len(model.requests) == 2
