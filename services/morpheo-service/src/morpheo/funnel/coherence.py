"""Coherence checks: when two answers do not fit, ask again instead of guessing.

v0.2 asks overlapping questions, and the AI may fill some of them from the
person's own words. A pair of answers can then contradict each other -- and the
rules read only one of them. Live test, 30/10/2026 (case FT-3): the person
sleeps 5 hours yet said they have enough time to sleep, so the schedule branch
never opened and H4 (sleeping little for lack of time) was never asked; and the
AI proposed "No" to I2 (no daily impact) for someone who reported daytime
tiredness. No rule oriented that interview.

Each check names one question to ask again, as `<id>@coherencia`; that answer
then counts over the first one (`Interview.answer`). The checks run just before
the closing questions, in the order below, each at most once. Thresholds live in
the artifact (`engine.coherence`): switched on by the owner on 31/10/2026, the
clinical lead's review pending. Pure and deterministic, like the rules.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from morpheo.funnel.extraction import ORIGIN_AI
from morpheo.funnel.interview import NO, SAFETY, YES, Interview, Step
from morpheo.funnel.rules import evaluate

COHERENCE = "@coherencia"
_HOURS = {"horas": 1, "dias": 24, "semanas": 24 * 7, "meses": 24 * 30.4, "años": 24 * 365}
# The checks run before the closing questions, so the safety questions are still
# "missing" here; that alone says nothing. A core answer that is missing does: the
# person will be told the information is not enough.
_NOT_ORIENTING = {"INFORMACION_INSUFICIENTE", "SIN_ORIENTACION"}


@dataclass(frozen=True)
class Check:
    id: str
    ask: str
    describes: str
    applies: Callable[[Interview, Mapping[str, Any]], bool]


def _sleep_hours(iv: Interview) -> float | None:
    q09 = iv.value("Q09")
    if not isinstance(q09, dict) or not isinstance(q09.get("value"), int | float):
        return None
    per = _HOURS.get(q09.get("unit", "horas"))
    return None if per is None else float(q09["value"]) * per


def _nothing_orients(iv: Interview) -> bool:
    result = evaluate(iv.a, iv.answers)
    orienting = {o.category for o in result.orientations} - _NOT_ORIENTING
    return not orienting and set(result.datos_pendientes) <= set(SAFETY)


def _short_sleep_with_time(iv: Interview, config: Mapping[str, Any]) -> bool:
    # Short sleep with enough time is also what insomnia looks like: asked only when
    # no rule orients the interview, or nearly everyone with insomnia would get it.
    hours = _sleep_hours(iv)
    return (
        hours is not None
        and hours <= config["max_hours"]
        and iv.value("Q13") == YES
        and iv.answer("H4") is None
        and _nothing_orients(iv)
    )


def _no_impact_from_the_ai_despite_daytime_symptoms(
    iv: Interview, _config: Mapping[str, Any]
) -> bool:
    i2 = iv.answer("I2")
    return (
        iv.branch_open("I")
        and i2 is not None
        and i2.origin == ORIGIN_AI
        and i2.value == NO
        and (iv.value("Q11") is not None or iv.value("Q12") == YES)
    )


CHECKS = (
    Check(
        "C-01",
        "H4",
        "Duerme pocas horas (Q09), dice tener tiempo y lugar adecuados (Q13 = Sí) y ninguna "
        "regla orienta: se pregunta H4 aunque la rama de horario no se haya abierto.",
        _short_sleep_with_time,
    ),
    Check(
        "C-02",
        "I2",
        "La IA propuso «No» a I2 (sin impacto en el día) y la persona refiere síntomas "
        "diurnos (Q11) o siestas (Q12 = Sí): I2 se pregunta directamente.",
        _no_impact_from_the_ai_despite_daytime_symptoms,
    ),
)


def pending(iv: Interview) -> Step | None:
    """The first check whose answers do not fit and has not been asked yet."""
    config: Mapping[str, Any] = iv.a.engine.get("coherence", {})
    for check in CHECKS:
        key = check.ask + COHERENCE
        if key in iv.answers or check.id not in config:
            continue
        if check.applies(iv, config[check.id]):
            return Step(key, iv.a.step(check.ask), "ask", f"{check.id}: {check.describes}")
    return None


__all__ = ["CHECKS", "COHERENCE", "Check", "pending"]
