"""A finished interview always says something (owner decision, 30/10/2026).

v0.2 has no outcome for an interview no rule orients: the result was empty --
no text, no report, and a download link that answered 404 (live test, case FT-3
with H4 not "Sí"). Now such an interview gets the «sin orientación» text. The
only interview that ends without text is one stopped at the age (out of scope),
and the app says so in its own words.

Interviews are played from start to finish with random answers -- every type,
"No lo sé" included -- the way the app asks them, and each result is checked.
"""

from __future__ import annotations

import random
from typing import Any

import pytest

from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.interview import NO_LO_SE, PREFIERO, Answer, Step, next_step
from morpheo.funnel.rules import evaluate
from morpheo.funnel.vignettes import load_vignettes, run_vignette

A = funnel_artifact()
UNITS = ["dias", "semanas", "meses", "años"]
WALKS = 400
MAX_STEPS = 200


def _answer(rng: random.Random, step: Step, calm: bool) -> Answer:
    """A random answer; a calm person says "No" and "none" far more often."""
    d = step.definition
    yes, unknown = (0.05, 0.01) if calm else (0.5, 0.1)
    if step.kind == "info":
        return Answer(value="visto")
    if step.kind == "confirm":
        return Answer(value="sigue_igual")
    if rng.random() < unknown:
        return Answer(absence=PREFIERO if d.type == "free_text" else NO_LO_SE)
    value: Any
    if d.type in ("yes_no", "yes_no_note"):
        value = "si" if rng.random() < yes else "no"
    elif d.type == "multi":
        keys = [o.key for o in d.options]
        value = [k for k in keys if rng.random() < yes]
    elif d.type == "single":
        value = rng.choice([o.key for o in d.options])
    elif d.type == "number":
        value = rng.randint(18, 90) if d.id == "AGE" else rng.randint(0, 7)
    elif d.type == "duration":
        value = {"value": rng.randint(1, 24), "unit": rng.choice(UNITS)}
    elif d.type == "times":
        value = {f.key: f"{rng.randint(0, 23):02d}:{rng.choice(['00', '30'])}" for f in d.fields}
    elif d.type == "free_text":
        return Answer(value="texto libre", text="texto libre")
    else:
        return Answer(absence=NO_LO_SE)
    return Answer(value=value)


def _walk(seed: int) -> dict[str, Answer]:
    rng = random.Random(seed)
    calm = seed % 2 == 0
    answers: dict[str, Answer] = {}
    for _ in range(MAX_STEPS):
        step = next_step(A, answers)
        if step is None:
            return answers
        answers[step.key] = _answer(rng, step, calm)
    raise AssertionError(f"seed {seed}: the interview never ends")


@pytest.mark.parametrize("seed", range(WALKS))
def test_a_finished_adult_interview_always_has_a_text(seed: int) -> None:
    result = evaluate(A, _walk(seed))
    assert result.texts, (seed, result.trace)
    assert result.accion_principal is not None


def test_some_random_interviews_reach_the_fallback() -> None:
    # Otherwise the walk above would not be testing the case that was empty.
    mains = {evaluate(A, _walk(seed)).accion_principal for seed in range(WALKS)}
    assert "SIN_ORIENTACION" in mains
    assert len(mains) > 2


@pytest.mark.parametrize("vignette", load_vignettes(), ids=lambda v: v["id"])
def test_every_vignette_has_a_text(vignette: dict[str, Any]) -> None:
    assert run_vignette(vignette, A).result.texts


def test_case_3_without_h4_gets_the_fallback_not_nothing() -> None:
    # The live test of 30/10/2026: FT-3, with H4 not "Sí".
    case = next(v for v in load_vignettes() if v["id"] == "FT-3")
    case = case | {"answers": case["answers"] | {"H4": "no"}}
    result = run_vignette(case, A).result
    assert result.accion_principal == "SIN_ORIENTACION"
    assert [t for t, _ in result.texts] == ["T_SIN_ORIENTACION"]


def test_only_a_minor_ends_without_text() -> None:
    result = evaluate(A, {"AGE": Answer(value=16)})
    assert result.stopped_by == "AGE_MENOR"
    assert result.texts == ()
