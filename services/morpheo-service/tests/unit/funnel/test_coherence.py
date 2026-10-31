"""Answers that do not fit are asked again, once, and the new answer is the one that counts."""

from __future__ import annotations

from typing import Any

import pytest

from morpheo.funnel import audit
from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.extraction import ORIGIN_AI
from morpheo.funnel.interview import NO_LO_SE, Answer, Interview, Step, next_step
from morpheo.funnel.rules import evaluate
from morpheo.funnel.vignettes import load_vignettes, run_vignette

A = funnel_artifact()
YES, NO = Answer(value="si"), Answer(value="no")
AI_NO = Answer(value="no", origin=ORIGIN_AI)
H4_AGAIN, I2_AGAIN = "H4@coherencia", "I2@coherencia"

# The live test of 30/10/2026 (case 3): sleeps 5 hours, "enough time", tired by day,
# and the AI read "no daily impact" from their words. Branch H never opens.
CASE_3 = {
    "AGE": Answer(value=23),
    "Q03": Answer(value={"value": 3, "unit": "meses"}, origin=ORIGIN_AI),
    "Q05": Answer(value=5),
    "Q08": Answer(value=["despertares"], origin=ORIGIN_AI),
    "Q09": Answer(value={"value": 5, "unit": "horas"}, origin=ORIGIN_AI),
    "Q11": Answer(value="cansancio"),
    "Q12": NO,
    "Q13": YES,
    "Q15": Answer(value=[]),
    "Q16": NO,
    "Q17": NO,
    "Q18": NO,
    "I1": YES,
    "I2": AI_NO,
}


def _play(answers: dict[str, Answer], **given: Answer) -> tuple[list[str], dict[str, Answer]]:
    """Plays to the end, answering "no" (or nothing) unless a key is given."""
    answers = dict(answers)
    again: list[str] = []
    for _ in range(100):
        step: Step | None = next_step(A, answers)
        if step is None:
            return again, answers
        if step.key.endswith("@coherencia"):
            again.append(step.key)
        answers[step.key] = given.get(step.key.replace("@", "_")) or _default(step)
    raise AssertionError("the interview never ends")


def _default(step: Step) -> Answer:
    if step.kind == "info":
        return Answer(value="visto")
    if step.kind == "confirm":
        return Answer(value="sigue_igual")
    d = step.definition
    if d.id == "Z1":
        return YES
    if d.type in ("yes_no", "yes_no_note"):
        return NO
    if d.type == "multi":
        return Answer(value=[])
    return Answer(absence=NO_LO_SE)


def test_the_live_case_is_asked_both_questions_once() -> None:
    again, _ = _play(CASE_3)
    assert again == [H4_AGAIN, I2_AGAIN]


def test_no_check_fires_before_the_closing_questions() -> None:
    # The answers already don't fit, but core questions are still pending.
    step = next_step(A, CASE_3)
    assert step is not None and step.definition.stage == "core"
    assert not step.key.endswith("@coherencia")


def test_h4_asked_again_reaches_the_orientation_the_case_should_have() -> None:
    _, answers = _play(CASE_3, H4_coherencia=YES)
    assert "T_HABITOS" in {t for t, _ in evaluate(A, answers).texts}


def test_the_person_can_confirm_it_and_the_fallback_still_answers() -> None:
    _, answers = _play(CASE_3)
    assert Interview(A, answers).value("I2") == "no"
    assert evaluate(A, answers).texts


def test_i2_asked_again_replaces_the_ai_and_the_branch_goes_on() -> None:
    again, answers = _play(CASE_3, I2_coherencia=YES)
    assert again == [H4_AGAIN, I2_AGAIN]
    iv = Interview(A, answers)
    assert iv.value("I2") == "si"
    assert iv.answer("I2") is answers[I2_AGAIN]


@pytest.mark.parametrize(
    ("changes", "absent"),
    [
        # C-01 needs short sleep...
        ({"Q09": Answer(value={"value": 7, "unit": "horas"})}, H4_AGAIN),
        # ...and "enough time": without it branch H opens and H4 is simply asked.
        ({"Q13": NO}, H4_AGAIN),
        # ...and a sleep length at all.
        ({"Q09": Answer(absence=NO_LO_SE)}, H4_AGAIN),
        # C-02: the person's own "No" is theirs; only the AI's is asked again.
        ({"I2": NO}, I2_AGAIN),
        ({"I2": Answer(value="no", origin="ia_corregido")}, I2_AGAIN),
        # ...and only a "No": an AI "Sí" stands.
        ({"I2": Answer(value="si", origin=ORIGIN_AI)}, I2_AGAIN),
    ],
)
def test_a_check_stays_silent_when_the_answers_fit(changes: dict[str, Answer], absent: str) -> None:
    again, _ = _play(CASE_3 | changes)
    assert absent not in again


def test_short_sleep_with_time_is_not_asked_of_someone_already_oriented() -> None:
    # Short sleep with enough time is also what insomnia looks like (FT-1): C-01 fired
    # on 7 of the 12 vignettes before it asked only when no rule orients.
    insomnia = CASE_3 | {
        "Q03": Answer(value={"value": 1, "unit": "años"}),
        "Q05": Answer(value=5),
        "I2": YES,
    }
    again, _ = _play(insomnia)
    assert H4_AGAIN not in again


@pytest.mark.parametrize("vignette", load_vignettes(), ids=lambda v: v["id"])
def test_no_written_case_needs_a_question_asked_again(vignette: dict[str, Any]) -> None:
    assert not [s.key for s in run_vignette(vignette, A).asked if "@coherencia" in s.key]


def test_six_hours_is_inside_the_proposed_limit_and_the_limit_is_the_artifacts() -> None:
    assert A.engine["coherence"]["C-01"]["max_hours"] == 6
    again, _ = _play(CASE_3 | {"Q09": Answer(value={"value": 6, "unit": "horas"})})
    assert H4_AGAIN in again


def test_an_artifact_without_the_checks_behaves_as_before() -> None:
    plain = audit.without_checks(A)
    answers = dict(CASE_3)
    for _ in range(100):
        step = next_step(plain, answers)
        if step is None:
            break
        assert not step.key.endswith("@coherencia")
        answers[step.key] = _default(step)
    assert "H4" not in answers


def test_a_stopped_interview_asks_nothing_more() -> None:
    assert next_step(A, CASE_3 | {"AGE": Answer(value=16)}) is None


# --- the audit -------------------------------------------------------------------------


def test_the_audit_is_reproducible_and_reads_every_persona() -> None:
    first = audit.run(40)
    second = audit.run(40)
    assert first[1].mains == second[1].mains
    assert set(first[1].by_persona) == {p.name for p in audit.PERSONAS}


def test_the_same_person_answers_the_same_with_and_without_the_checks() -> None:
    plain = audit.without_checks(A)
    for seed in range(30):
        _, without = audit.interview(seed, plain)
        _, with_checks = audit.interview(seed, A)
        shared = set(without) & set(with_checks)
        assert all(without[k] == with_checks[k] for k in shared), seed


def test_the_audit_finds_the_live_incoherences() -> None:
    iv = Interview(A, CASE_3)
    found = {f.id for f in audit.INCOHERENCES if f.test(iv)}
    assert {"K01", "K02"} <= found


def test_what_the_design_already_prevents_never_appears() -> None:
    # K06: I3 is not asked when Q03/Q05 settle it (D-15).
    before, after = audit.run(200)
    assert before.incoherent["K06"] == after.incoherent["K06"] == 0


def test_every_finished_audited_interview_has_a_text() -> None:
    for seed in range(100):
        _, answers = audit.interview(seed, A)
        assert evaluate(A, answers).texts, seed


def test_the_report_names_every_finding(capsys: Any) -> None:
    assert audit.main(["--walks", "10"]) == 0
    text = capsys.readouterr().out
    for finding in (*audit.INCOHERENCES, *audit.SIGNALS):
        assert finding.id in text
