"""What the AI proposes counts only once the person confirms it (v0.2 p. 14)."""

from __future__ import annotations

from typing import Any

from morpheo.funnel.ai_steps import CONFIRM_KIND
from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.extraction import (
    Q14_FLAGS,
    Item,
    Record,
    all_targets,
    expand,
    is_editable,
)
from morpheo.funnel.interview import Answer, Interview, next_step
from morpheo.funnel.rules import evaluate

A = funnel_artifact()
RISK_NO = {"S1": "no", "S4": "no", "S2": "no"}
START = {
    "AGE": Answer(value=45),
    "S1@start": Answer(value="no"),
    "S4@start": Answer(value="no"),
}


def _with_record(items: list[Item], text: str = "relato", **more: Answer) -> dict[str, Answer]:
    record = Record(source="Q01", status="ok", items=tuple(items), risk=RISK_NO)
    return {
        **START,
        "Q01": Answer(value=text, text=text),
        "Q01#ia": Answer(value=record.to_json()),
        **more,
    }


def _decide(**decisions: Any) -> Answer:
    return Answer(
        value={
            k.replace("__", "."): (v if isinstance(v, dict) else {"decision": v})
            for k, v in decisions.items()
        }
    )


Q03 = Item("Q03", {"value": 6, "unit": "meses"}, "Desde hace unos seis meses")
Q08 = Item("Q08", ["despertares"], "me despierto")
BIPOLAR = Item("Q14.bipolaridad", True, "Tengo trastorno bipolar")


def test_targets_never_include_safety_age_or_the_narratives_themselves() -> None:
    ids = {t.id for t in all_targets(A)}
    assert not ids & {"AGE", "S1", "S2", "S3", "S4", "Q01", "Q06", "Q14", "Z1", "Z2", "PROT"}
    # A branch question that follows from a core one is not extracted on its own.
    assert not ids & {"R1", "D1", "P1", "N1", "I4", "H1"}
    assert {"Q03", "Q05", "Q08", "Q11", "Q15", "I2", "R2c", "R6", "H3b"} <= ids
    assert {f"Q14.{name}" for name in Q14_FLAGS} <= ids


def test_ninguna_is_never_offered_to_the_model() -> None:
    q11 = next(t for t in all_targets(A) if t.id == "Q11")
    assert "ninguna" not in q11.options


def test_the_confirmation_screen_comes_right_after_the_narrative() -> None:
    step = next_step(A, _with_record([Q03, Q08]))
    assert step is not None and step.key == "Q01#confirmacion" and step.kind == CONFIRM_KIND


def test_nothing_counts_before_the_person_decides() -> None:
    answers = _with_record([Q03, Q08])
    assert Interview(A, answers).value("Q03") is None
    assert "Q03" not in expand(answers, A)


def test_a_confirmed_item_is_not_asked_and_reads_as_an_answer() -> None:
    answers = _with_record(
        [Q03, Q08], **{"Q01#confirmacion": _decide(Q03="confirmado", Q08="confirmado")}
    )
    iv = Interview(A, answers)
    assert iv.value("Q03") == {"value": 6, "unit": "meses"}
    assert iv.answers["Q03"].origin == "ia" and iv.answers["Q03"].evidence == Q03.evidence
    keys = []
    for _ in range(12):
        step = next_step(A, answers)
        assert step is not None
        keys.append(step.key)
        answers[step.key] = Answer(absence="prefiero_no_responder")
    assert "Q03" not in keys and "Q08" not in keys and "Q02" in keys


def test_a_removed_item_is_asked_in_its_turn_and_never_read() -> None:
    answers = _with_record([Q03], **{"Q01#confirmacion": _decide(Q03="quitado")})
    assert Interview(A, answers).value("Q03") is None
    for _ in range(5):
        step = next_step(A, answers)
        assert step is not None
        if step.key == "Q03":
            return
        answers[step.key] = Answer(absence="prefiero_no_responder")
    raise AssertionError("Q03 was not asked after being removed")


def test_a_corrected_item_counts_with_the_persons_value() -> None:
    corrected = {"decision": "corregido", "value": {"value": 2, "unit": "años"}}
    answers = _with_record([Q03], **{"Q01#confirmacion": _decide(Q03=corrected)})
    iv = Interview(A, answers)
    assert iv.value("Q03") == {"value": 2, "unit": "años"}
    assert iv.answers["Q03"].origin == "ia_corregido"


def test_a_direct_answer_always_wins_over_an_extraction() -> None:
    answers = _with_record(
        [Q03],
        Q03=Answer(value={"value": 1, "unit": "semanas"}),
        **{"Q01#confirmacion": _decide(Q03="confirmado")},
    )
    assert Interview(A, answers).value("Q03") == {"value": 1, "unit": "semanas"}


def test_a_confirmed_q14_flag_reaches_r07_and_a_removed_one_does_not() -> None:
    kept = _with_record([BIPOLAR], **{"Q01#confirmacion": _decide(Q14__bipolaridad="confirmado")})
    removed = _with_record([BIPOLAR], **{"Q01#confirmacion": _decide(Q14__bipolaridad="quitado")})
    pending = _with_record([BIPOLAR])
    assert Interview(A, kept).extracted("bipolaridad") is True
    assert Interview(A, removed).extracted("bipolaridad") is None
    assert Interview(A, pending).extracted("bipolaridad") is None


def test_q07_is_asked_one_time_at_a_time_and_only_the_missing_ones() -> None:
    """v0.2 p. 3: «Completar solo horarios que falten; separar cada pregunta»."""
    bed = Item("Q07a", {"acostarse": "01:00"}, "Me acuesto a la una")
    wake = Item("Q07c", {"despertarse": "06:00"}, "a las seis suena el despertador")
    answers = _with_record(
        [bed, wake], **{"Q01#confirmacion": _decide(Q07a="confirmado", Q07c="confirmado")}
    )
    for key in ("Q02", "Q03", "Q04", "Q05", "Q06"):
        answers[key] = Answer(absence="prefiero_no_responder")
    asked = []
    for _ in range(2):
        step = next_step(A, answers)
        assert step is not None
        asked.append((step.key, step.definition.text, [f.key for f in step.definition.fields]))
        answers[step.key] = Answer(value={step.definition.fields[0].key: "06:15"})
    assert asked == [
        ("Q07b", "¿A qué hora intenta dormir?", ["intentar_dormir"]),
        ("Q07d", "¿A qué hora se levanta?", ["levantarse"]),
    ]


def test_answers_in_the_persons_own_words_are_never_taken_from_the_narrative() -> None:
    """Owner decision 19/10/2026: Q02, Q04, Q10 and Q14's text parts are asked as
    v0.2 asks them, never filled with a sentence of the narrative."""
    by_id = {t.id: t for t in all_targets(A)}
    for item_id in ("Q02", "Q04", "Q10", "Q14.molestias", "Q14.tratamientos", "Q14.consumo"):
        assert item_id not in by_id, item_id
    assert is_editable(by_id["Q03"]) and is_editable(by_id["Q08"]) and is_editable(by_id["Q07a"])
    assert not is_editable(by_id["Q14.bipolaridad"])
    assert "Q14a" not in by_id  # a Q14 screen is answered in the person's words


def test_a_confirmed_q11_still_asks_s2_at_once() -> None:
    sleepy = Item("Q11", "dormido_sin_querer", "me quedo dormido sin querer")
    answers = _with_record([sleepy], **{"Q01#confirmacion": _decide(Q11="confirmado")})
    step = next_step(A, answers)
    assert step is not None and step.key == "S2@ask_now:Q11"


def test_the_result_never_reads_an_unconfirmed_value() -> None:
    """The same proposals, undecided and removed: the result is the one without them."""
    plain = {**START, "Q01": Answer(value="relato", text="relato")}
    undecided = _with_record([Q03, Q08, BIPOLAR])
    removed = _with_record(
        [Q03, Q08, BIPOLAR],
        **{"Q01#confirmacion": _decide(Q03="quitado", Q08="quitado", Q14__bipolaridad="quitado")},
    )
    base = evaluate(A, plain)
    for answers in (undecided, removed):
        result = evaluate(A, answers)
        assert result.texts == base.texts and result.rule_ids == base.rule_ids
        assert result.flags == base.flags


def test_an_item_the_person_did_not_decide_on_is_never_read() -> None:
    answers = _with_record([Q03, Q08], **{"Q01#confirmacion": _decide(Q03="confirmado")})
    iv = Interview(A, answers)
    assert iv.value("Q03") == {"value": 6, "unit": "meses"}
    assert iv.value("Q08") is None
