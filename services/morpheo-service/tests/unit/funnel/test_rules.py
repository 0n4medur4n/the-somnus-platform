"""Rules R01-R08: unknown is never "no", and the order of priority holds."""

from __future__ import annotations

from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.interview import NO_LO_SE, Answer
from morpheo.funnel.rules import evaluate

A = funnel_artifact()
YES, NO = Answer(value="si"), Answer(value="no")
UNKNOWN = Answer(absence=NO_LO_SE)

# An adult who answered "No" to every safety question and has nothing else.
CALM = {
    "AGE": Answer(value=40),
    "S1@start": NO,
    "S4@start": NO,
    "S2@end": NO,
    "S3@end": NO,
    "Q08": Answer(value=[]),
    "Q15": Answer(value=[]),
    "Q13": YES,
    "Q11": Answer(value="ninguna"),
    "Q16": NO,
    "Q17": NO,
}


def _templates(answers: dict[str, Answer]) -> set[str]:
    return {t for t, _ in evaluate(A, answers).texts}


def test_nothing_reported_still_says_something() -> None:
    # Owner decision, 30/10/2026: no rule orients → the approved «sin orientación»
    # text, never an empty result (it used to give no text, no report and a 404).
    result = evaluate(A, CALM)
    assert result.accion_principal == "SIN_ORIENTACION"
    assert [t for t, _ in result.texts] == ["T_SIN_ORIENTACION"]
    assert "no descarta" in dict(result.texts)["T_SIN_ORIENTACION"]
    assert result.rule_ids == ("SIN_REGLA",)


def test_the_fallback_never_joins_a_real_orientation() -> None:
    result = evaluate(A, CALM | {"H4": YES})
    assert result.accion_principal == "HABITOS"
    assert "T_SIN_ORIENTACION" not in {t for t, _ in result.texts}


def test_an_unanswered_safety_question_is_pending_not_no() -> None:
    answers = dict(CALM)
    del answers["S3@end"]
    result = evaluate(A, answers)
    assert result.accion_principal == "INFORMACION_INSUFICIENTE"
    assert "S3" in result.datos_pendientes


def test_unknown_snoring_does_not_rule_out_apnoea() -> None:
    # R03 / D-24: "No lo sé" to whether someone has heard them snore.
    answers = CALM | {"Q15": UNKNOWN, "R1": UNKNOWN, "R3": YES, "R4": Answer(value=[])}
    assert "T_RESPIRACION" in _templates(answers)
    assert evaluate(A, answers).accion_principal == "CONSULTA_ESTUDIO"


def test_unknown_complexity_sends_to_a_laboratory_study() -> None:
    # D-17: with breathing suspicion, an unanswered R4 counts as complexity.
    answers = CALM | {"Q15": Answer(value=["dejar_de_respirar"]), "R4": UNKNOWN}
    result = evaluate(A, answers)
    assert "T_PSG" in {t for t, _ in result.texts}
    assert result.prueba_a_valorar == "polisomnografía en laboratorio"


def test_s3_yes_is_same_day_care_and_outranks_everything_else() -> None:
    answers = CALM | {
        "S3@end": YES,
        "Q15": Answer(value=["dejar_de_respirar"]),
        "R4": Answer(value=[]),
    }
    result = evaluate(A, answers)
    assert result.accion_principal == "ATENCION_MISMO_DIA"
    assert "CONSULTA_ESTUDIO" in result.acciones_asociadas


def test_s4_yes_is_an_emergency_with_112_and_024() -> None:
    result = evaluate(A, CALM | {"S4@start": YES})
    assert result.stopped_by == "S4"
    assert result.alerts == ("EMERGENCIA",)
    text = dict(result.texts)["T_SEGURIDAD"]
    assert "112" in text and "024" in text


def test_a_minor_gets_no_orientation() -> None:
    result = evaluate(A, {"AGE": Answer(value=16)})
    assert result.stopped_by == "AGE_MENOR"
    assert result.alerts == ("RUTA_PEDIATRICA",)
    assert result.texts == ()


def test_insomnia_with_habits_keeps_therapy_as_the_main_action() -> None:
    insomnia = {
        "Q08": Answer(value=["despertares"]),
        "Q05": Answer(value=4),
        "Q03": Answer(value={"value": 6, "unit": "meses"}),
        "I1": YES,
        "I2": YES,
        "H4": NO,
    }
    result = evaluate(A, CALM | insomnia)
    assert result.accion_principal == "TERAPIA"
    assert result.rule_ids == ("R04",)


def test_recent_insomnia_with_high_impact_gets_clinical_help_without_waiting() -> None:
    recent = {
        "Q08": Answer(value=["despertares"]),
        "Q05": Answer(value=5),
        "Q03": Answer(value={"value": 3, "unit": "semanas"}),
        "I1": YES,
        "I2": YES,
    }
    result = evaluate(A, CALM | recent)
    texts = dict(result.texts)
    assert texts["T_RECIENTE"].startswith("Nos ha contado que desde hace poco le cuesta dormir")
    assert "T_INSOMNIO" not in texts
    assert result.accion_principal == "CONSULTA_ESTUDIO"


def test_same_day_care_gets_the_drafted_s3_action() -> None:
    text = dict(evaluate(A, CALM | {"S3@end": YES}).texts)["T_SEGURIDAD"]
    assert "hoy mismo" in text and "112" in text
    assert "Aclarar impulsividad" not in text


def test_a_paused_interview_keeps_the_warning_and_says_why_it_stopped() -> None:
    answers = CALM | {
        "Q11": Answer(value="dormido_sin_querer"),
        "S2@ask_now:Q11": YES,
        "S2_aviso": Answer(value="visto"),
        "S2_seguro": NO,
    }
    result = evaluate(A, answers)
    assert result.stopped_by == "S2_PAUSA"
    assert result.accion_principal == "EVALUACION_PRIORITARIA"
    assert [t for t, _ in result.texts] == ["S2_aviso", "T_SOMNOLENCIA", "S2_pausa"]
