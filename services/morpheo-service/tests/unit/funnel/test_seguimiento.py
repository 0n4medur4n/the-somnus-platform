"""Jesús's answers of 24/11/2026 to «Morpheo: revisión de coherencia del motor».

The interviews that ended with no orientation are told apart: a sustained
orientation, a difficulty that asks for support and follow-up (SEGUIMIENTO, R09),
and an interview with too little information. Nobody is pushed into a clinical
category to fill the gap: the follow-up outputs never assign therapy, habits or a
study. Each text is the clinical lead's own, in every language.
"""

from __future__ import annotations

import pytest

from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.extraction import ORIGIN_AI
from morpheo.funnel.interview import NO_LO_SE, Answer, Step, next_step
from morpheo.funnel.locales import bundle
from morpheo.funnel.rules import FunnelResult, evaluate
from morpheo.funnel.vignettes import load_vignettes, run_vignette

A = funnel_artifact()
YES, NO = Answer(value="si"), Answer(value="no")
FOLLOW_UP = {"T_SIN_IMPACTO_CANSANCIO", "T_SIN_IMPACTO", "T_CANSANCIO", "T_RONQUIDO"}
VIGNETTES = {v["id"]: v for v in load_vignettes()}

START = {
    "AGE": Answer(value=40),
    "SEX": Answer(value="mujer"),
    "Q03": Answer(value={"value": 6, "unit": "meses"}),
    "Q05": Answer(value=4),
    "Q09": Answer(value={"value": 7, "unit": "horas"}),
    "Q12": NO,
    "Q13": YES,
    "Q15": Answer(value=[]),
    "Q16": NO,
    "Q17": NO,
    "Q18": NO,
}


def _play(**given: Answer) -> tuple[list[str], FunnelResult]:
    """From START plus `given` to the end; anything else is "No" (or nothing)."""
    answers: dict[str, Answer] = {**START, **{k.replace("_at_", "@"): v for k, v in given.items()}}
    asked: list[str] = []
    for _ in range(150):
        step: Step | None = next_step(A, answers)
        if step is None:
            return asked, evaluate(A, answers)
        asked.append(step.key)
        answers[step.key] = _default(step)
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


def _templates(result: FunnelResult) -> list[str]:
    return [t for t, _ in result.texts]


# --- the texts are Jesús's, word for word ---


def test_the_follow_up_texts_are_the_clinical_leads_own() -> None:
    assert A.templates["T_SIN_IMPACTO"] == (
        "«Describe dificultades para dormir, pero no refiere que le afecten de forma importante"
        " durante el día ni que le produzcan un malestar importante. Podemos revisar qué le"
        " preocupa de su sueño y observar su evolución. Si aparece malestar, afecta a sus"
        " actividades o el problema empeora, conviene una valoración profesional.»"
    )
    assert A.templates["T_CANSANCIO"].startswith(
        "«Nos ha contado que nota cansancio durante el día, sin identificar dificultades"
    )
    assert A.templates["T_RONQUIDO"].startswith("«Ha referido ronquido fuerte. Este dato por sí")
    # Case 3: his sentence, with «cinco horas» and «tiene despertares» from the answers.
    assert (
        "duerme unas [horas de sueño] y que [dificultad], aunque no refiere"
        in (A.templates["T_SIN_IMPACTO_CANSANCIO"])
    )
    for addition in A.engine["template_additions"]:
        assert addition["decided"].startswith("Jesús, 24/11/2026")


def test_case_3_reads_with_the_persons_own_hours_and_difficulty() -> None:
    result = run_vignette(VIGNETTES["C3-1"], A).result
    (text,) = [x for t, x in result.texts if t == "T_SIN_IMPACTO_CANSANCIO"]
    assert text.startswith(
        "Nos ha contado que duerme unas 5 horas y que se despierta varias veces por la noche,"
        " aunque no refiere que esta dificultad le afecte"
    )


# --- caso 3 and recorrido B: I1 = Sí, I2 = No ---


def test_a_no_to_i2_from_the_ai_is_always_asked_directly() -> None:
    """C-02 (Jesús, 24/11/2026): whenever the AI gave the «No», without needing any
    daytime symptom (no Q11, no nap)."""
    asked, result = _play(
        Q08=Answer(value=["dormirse"]),
        Q11=Answer(absence=NO_LO_SE),
        I1=YES,
        I2=Answer(value="no", origin=ORIGIN_AI),
    )
    assert "I2@coherencia" in asked
    # Kept by the person (the default here is "No"): respected, follow-up.
    assert result.accion_principal == "SEGUIMIENTO"
    assert _templates(result) == ["T_SIN_IMPACTO"]


def test_the_persons_own_no_to_i2_is_not_asked_again_and_gets_no_therapy() -> None:
    asked, result = _play(
        Q08=Answer(value=["despertares"]), Q11=Answer(value="ninguna"), I1=YES, I2=NO
    )
    assert "I2@coherencia" not in asked
    assert result.accion_principal == "SEGUIMIENTO"
    assert not {"T_INSOMNIO", "T_HABITOS", "T_PSG"} & set(_templates(result))
    assert result.prueba_a_valorar is None


def test_the_case_3_text_needs_tiredness_hours_and_a_difficulty() -> None:
    # Without tiredness: the general text of recorrido B.
    _, result = _play(Q08=Answer(value=["despertares"]), Q11=Answer(value="ninguna"), I1=YES, I2=NO)
    assert _templates(result) == ["T_SIN_IMPACTO"]
    # Without the hours: the general text too, never a sentence with a gap.
    _, result = _play(
        Q08=Answer(value=["despertares"]),
        Q09=Answer(absence=NO_LO_SE),
        Q11=Answer(value="cansancio"),
        I1=YES,
        I2=NO,
    )
    assert _templates(result) == ["T_SIN_IMPACTO"]


def test_a_sustained_orientation_wins_over_the_follow_up() -> None:
    # Little time to sleep (H4 = Sí): habits, as before; no follow-up text beside it.
    _, result = _play(
        Q08=Answer(value=["despertares"]), Q11=Answer(value="cansancio"), I1=YES, I2=NO, H4=YES
    )
    assert result.accion_principal == "HABITOS"
    assert not FOLLOW_UP & set(_templates(result))


# --- recorrido A: tiredness without a difficulty at night ---


def test_tiredness_without_a_night_difficulty_has_its_own_text() -> None:
    _, result = _play(Q08=Answer(value=[]), Q11=Answer(value="cansancio"))
    assert result.accion_principal == "SEGUIMIENTO"
    assert _templates(result) == ["T_CANSANCIO"]
    # Neither insomnia nor sleepiness: no branch of them opens for it.
    assert not {"T_INSOMNIO", "T_SOMNOLENCIA"} & set(_templates(result))


@pytest.mark.parametrize(
    ("q08", "q11"),
    [
        (Answer(absence=NO_LO_SE), Answer(value="cansancio")),  # night not known: not «none»
        (Answer(value=[]), Answer(value="ninguna")),  # Q11 «ninguna»: no tiredness to explain
        (Answer(value=[]), Answer(absence=NO_LO_SE)),
    ],
)
def test_the_tiredness_text_needs_a_confirmed_none_and_tiredness(q08: Answer, q11: Answer) -> None:
    _, result = _play(Q08=q08, Q11=q11)
    assert "T_CANSANCIO" not in _templates(result)


def test_q11_offers_none_of_these() -> None:
    q11 = A.step("Q11")
    assert q11.none_option and [o.key for o in q11.options] == [
        "cansancio",
        "dormido_sin_querer",
        "ambas",
    ]


# --- recorrido C: P2 reworded ---


def test_p2_asks_for_any_of_the_three_situations() -> None:
    p2 = A.step("P2")
    assert p2.text.startswith("Además, ¿experimenta alguna de estas situaciones relacionadas")
    revision = next(r for r in A.engine["source_revisions"] if r["id"] == "P2")
    assert revision["v02_text"].startswith("¿Ocurre en reposo, mejora con movimiento")
    _, result = _play(Q16=YES, P2=YES)
    assert "T_PIERNAS" in _templates(result)


# --- recorrido D: isolated loud snoring ---


def test_isolated_loud_snoring_opens_a_review_never_a_study() -> None:
    run = run_vignette(VIGNETTES["RD-1"], A)
    assert run.result.accion_principal == "SEGUIMIENTO"
    assert _templates(run.result) == ["T_RONQUIDO"]
    assert run.result.prueba_a_valorar is None


def test_snoring_with_another_breathing_sign_is_not_isolated() -> None:
    _, result = _play(Q15=Answer(value=["ronca_fuerte", "dejar_de_respirar"]))
    assert "T_RONQUIDO" not in _templates(result)
    assert "T_RESPIRACION" in _templates(result)


def test_isolated_snoring_goes_with_another_orientation() -> None:
    # R08: compatible orientations combine; the snoring review does not replace them.
    _, result = _play(Q15=Answer(value=["ronca_fuerte"]), Q16=YES, P2=YES)
    assert {"T_PIERNAS", "T_RONQUIDO"} <= set(_templates(result))
    assert result.accion_principal == "CONSULTA_ESTUDIO"


# --- every language ---


@pytest.mark.parametrize("locale", ["ca", "en", "fr"])
@pytest.mark.parametrize("case", ["C3-1", "C3-2", "RB-1", "RC-1", "RD-1"])
def test_the_new_outputs_read_whole_in_every_language(locale: str, case: str) -> None:
    artifact = bundle(locale).artifact
    spanish = run_vignette(VIGNETTES[case], A).result
    mine = run_vignette(VIGNETTES[case], artifact).result
    assert _templates(mine) == _templates(spanish)
    assert mine.accion_principal == spanish.accion_principal
    for _, text in mine.texts:
        assert "[" not in text and "]" not in text
    if case == "C3-1":
        hours = artifact.lang.units["horas"][1]
        assert f"5 {hours}" in dict(mine.texts)["T_SIN_IMPACTO_CANSANCIO"]


def test_a_follow_up_is_not_an_orientation_for_the_coherence_check() -> None:
    """C-01 still asks H4 when only a follow-up text would close the interview."""
    run = run_vignette(VIGNETTES["C3-2"], A)
    assert "H4@coherencia" in [s.key for s in run.asked]
