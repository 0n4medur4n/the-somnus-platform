"""Immediate risk with the AI on: it can add safety questions, never take one away.

Negative tests: once green, they are not changed (CLAUDE.md).
"""

from __future__ import annotations

from typing import Any

from morpheo.ai.pipeline import AiExtractor
from morpheo.ai.provider import FailingProvider, ModelReply, ModelRequest
from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.extraction import Record
from morpheo.funnel.interview import Answer, Step, next_step

A = funnel_artifact()
START = {
    "AGE": Answer(value=40),
    "S1@start": Answer(value="no"),
    "S4@start": Answer(value="no"),
}


def _record(source: str, status: str = "ok", **risk: str) -> Answer:
    full = {"S1": "no", "S4": "no", "S2": "no", **risk} if status == "ok" else {}
    return Answer(value=Record(source=source, status=status, risk=full).to_json())


def _after(text: str, extractor: AiExtractor, answers: dict[str, Answer] | None = None) -> Any:
    """Q01 answered with `text`, the AI's record stored as the service stores it."""
    answers = {**START, **(answers or {}), "Q01": Answer(value=text, text=text)}
    call = extractor.process(A, answers, "Q01", text)
    assert call is not None
    answers["Q01#ia"] = Answer(value=call.record.to_json())
    return answers


def _next(answers: dict[str, Answer]) -> Step:
    step = next_step(A, answers)
    assert step is not None
    return step


DOWN = AiExtractor(FailingProvider("timeout"))


def test_suicidal_ideation_asks_s4_at_once_even_when_the_ai_call_fails() -> None:
    answers = _after("A veces pienso que lo mejor sería quitarme la vida.", DOWN)
    step = _next(answers)
    assert step.key == "S4@exception:Q01"
    answers[step.key] = Answer(value="si")
    assert next_step(A, answers) is None  # S4 = Sí ends the interview (p. 10)


def test_suicidal_ideation_without_any_listed_term_is_still_asked_when_the_ai_fails() -> None:
    """The term list misses it; the failed call's fallback asks S1 and S4 anyway."""
    answers = _after("No quiero despertarme nunca más.", DOWN)
    asked = []
    for _ in range(3):
        step = _next(answers)
        asked.append(step.key)
        answers[step.key] = Answer(value="no")
    assert asked == ["S1@exception:Q01", "S4@exception:Q01", "S2@exception:Q01"]


def test_drowsy_driving_asks_s2_at_once_even_when_the_ai_call_fails() -> None:
    answers = _after("Me dormí conduciendo la semana pasada.", DOWN)
    step = _next(answers)
    assert step.key in ("S2@exception:Q01", "S1@exception:Q01")
    keys = []
    for _ in range(4):
        step = _next(answers)
        keys.append(step.key)
        answers[step.key] = Answer(value="si" if step.key.startswith("S2") else "no")
        if step.key.startswith("S2"):
            break
    assert "S2@exception:Q01" in keys
    assert _next(answers).key == "S2_aviso"  # p. 10: the warning first


def test_the_fallback_runs_once_per_interview() -> None:
    answers = {**START, "Q01": Answer(value="x", text="x"), "Q01#ia": _record("Q01", "failed")}
    for _ in range(3):
        step = _next(answers)
        assert step.key.endswith("@exception:Q01")
        answers[step.key] = Answer(value="no")
    answers["Q02"] = Answer(value="y", text="y")
    answers["Q02#ia"] = _record("Q02", "failed")
    assert not _next(answers).key.endswith("@exception:Q02")


def test_an_unsure_classifier_asks_nothing_at_that_moment() -> None:
    """Owner decision 19/10/2026 (v0.2 p. 1: act at that moment only when a risk
    appears): "dudoso" waits for the closing S1-S4 block. It replaces the earlier
    DEFAULT under which "dudoso" asked S1/S4/S2 at once."""
    answers = {**START, "Q01": Answer(value="x", text="x"), "Q01#ia": _record("Q01", S4="dudoso")}
    assert _next(answers).key == "Q02"


def test_a_positive_risk_asks_that_question_at_that_moment() -> None:
    answers = {**START, "Q01": Answer(value="x", text="x"), "Q01#ia": _record("Q01", S1="si")}
    step = _next(answers)
    assert step.key == "S1@exception:Q01" and step.reason is not None and "IA" in step.reason


def test_the_ai_saying_no_never_silences_the_term_list() -> None:
    class SaysNo:
        model, region = "m", "eu"

        def complete(self, request: ModelRequest) -> ModelReply:
            return ModelReply('{"items": [], "risk": {"S1": "no", "S4": "no", "S2": "no"}}', "m")

    answers = _after("Soy camionero y me dormí conduciendo.", AiExtractor(SaysNo()))  # type: ignore[arg-type]
    assert _next(answers).key == "S2@exception:Q01"


def test_only_the_persons_answer_raises_an_alert() -> None:
    answers = {**START, "Q01": Answer(value="x", text="x"), "Q01#ia": _record("Q01", S4="si")}
    answers["S4@exception:Q01"] = Answer(value="no")
    step = _next(answers)
    assert not step.key.startswith("S4")  # asked once for this text, the "No" stands


def test_s2_once_asked_is_not_asked_again_by_the_ai() -> None:
    answers = {
        **START,
        "Q01": Answer(value="x", text="x"),
        "S2@exception:Q01": Answer(value="no"),
        "Q01#ia": _record("Q01", S2="si"),
    }
    assert not _next(answers).key.startswith("S2")


def test_safety_comes_before_the_confirmation_screen() -> None:
    record = Record(
        source="Q01",
        status="ok",
        items=(),
        risk={"S1": "no", "S4": "si", "S2": "no"},
    ).to_json()
    record["items"] = [{"id": "Q03", "value": {"value": 6, "unit": "meses"}, "evidence": "x"}]
    answers = {**START, "Q01": Answer(value="x", text="x"), "Q01#ia": Answer(value=record)}
    assert _next(answers).key == "S4@exception:Q01"
    answers["S4@exception:Q01"] = Answer(value="no")
    assert _next(answers).key == "Q01#confirmacion"


def test_a_failed_call_after_the_closing_block_asks_nothing_again() -> None:
    """Seen live: a timeout on Z2 asked S1 and S4 right after the person had answered
    them in the closing block. A question answered there is not asked again."""
    answers = {**START, "Q01": Answer(value="x", text="x")}
    for q in ("S1", "S2", "S3", "S4"):
        answers[f"{q}@end"] = Answer(value="no")
    answers["Z2"] = Answer(value="y", text="y")
    answers["Z2#ia"] = _record("Z2", "failed")
    step = next_step(A, answers)
    assert step is None or "@exception:Z2" not in step.key
