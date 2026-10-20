"""The steps the AI's records add to the interview (pure, deterministic).

Each model call leaves a record (`<source>#ia`, see `extraction.Record`).
Reading the records in the order they were written, the interview

1. asks a safety question *at that moment* when the risk classifier says "si"
   for it -- the AI adds a question, never an alert: only the person's answer
   raises one (D-01). The term list keeps running on its own; both use the same
   key (`S4@exception:Q01`), so a question is never asked twice for one text;
2. when a call failed (provider down, timeout, out of schema), asks S1 and
   S4, and S2 if it has not been asked yet -- once per interview, at the first
   failed call (a DEFAULT the clinical lead can change): without the screen,
   the free text was not read for risk. An unsure classifier ("dudoso") asks
   nothing at that moment (owner decision 19/10/2026, v0.2 p. 1: act at that
   moment only when a risk appears); the closing S1-S4 block still comes. The
   AI can add safety questions, never take one away;
3. then shows the confirmation screen for what the call proposed («Por lo que
   nos ha contado, entendemos: … ¿Es correcto?»). Only what the person keeps
   or corrects there counts (`extraction.expand`).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping

from morpheo.funnel.artifact import FunnelArtifact, StepDef
from morpheo.funnel.extraction import (
    DECISION,
    RECORD,
    RISK_QUESTIONS,
    is_record_key,
    record_of,
)
from morpheo.funnel.instruments import DEFAULT_MARK
from morpheo.funnel.interview import Answer, Interview, Step

# The owner's wording for the screen (19/10/2026 instruction).
CONFIRM_TEXT = "Por lo que nos ha contado, entendemos:"
CONFIRM_QUESTION = "¿Es correcto?"
CONFIRM_KIND = "confirm_extraction"


def confirm_step(stage: str) -> StepDef:
    return StepDef("IA_CONFIRMAR", "p. 14", stage, CONFIRM_KIND, CONFIRM_TEXT, CONFIRM_QUESTION)


def fallback_source(answers: Mapping[str, Answer]) -> str | None:
    """The source of the first failed call: the one that asks S1/S4/S2."""
    for key, answer in answers.items():
        record = record_of(answer) if is_record_key(key) else None
        if record is not None and record.status != "ok":
            return record.source
    return None


def pending(
    artifact: FunnelArtifact,
    iv: Interview,
    key: str,
    answer: Answer,
    fallback: str | None,
    already_settled: Callable[[str], bool],
) -> Step | None:
    """What a record still needs from the person, if `key` is a record."""
    if not is_record_key(key):
        return None
    record = record_of(answer)
    if record is None:
        return None
    answers = iv.answers
    source = record.source

    def ask(question: str, reason: str) -> Step | None:
        step_key = f"{question}@exception:{source}"
        if step_key in answers or already_settled(question):
            return None
        # Answered (or confirmed) in the closing block just now: not again.
        if f"{question}@end" in answers or f"{question}@confirm" in answers:
            return None
        return Step(step_key, artifact.step(question, "end"), "ask", reason)

    for question in RISK_QUESTIONS:
        if record.risk.get(question) == "si":
            step = ask(question, f"IA: posible riesgo ({question}) en {source}")
            if step is not None:
                return step
    if fallback == source:
        for question in RISK_QUESTIONS:
            reason = f"IA falló en {source}: S1, S4 y S2 ahora, una vez ({DEFAULT_MARK})"
            step = ask(question, reason)
            if step is not None:
                return step
    if record.items and source + DECISION not in answers:
        stage = iv._first(source.split("@")[0])
        return Step(
            source + DECISION,
            confirm_step(stage.stage if stage is not None else "core"),
            CONFIRM_KIND,
            "p. 14: confirmar lo extraído del relato antes de usarlo",
        )
    return None


__all__ = ["CONFIRM_KIND", "CONFIRM_TEXT", "RECORD", "confirm_step", "fallback_source", "pending"]
