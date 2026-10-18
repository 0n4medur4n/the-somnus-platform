"""The interview order, the cross-cutting exception and never asking twice."""

from __future__ import annotations

from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.interview import NO_LO_SE, PREFIERO, Answer, next_step, risk_hits

A = funnel_artifact()
ADULT = Answer(value=40)


def _walk(script: dict[str, Answer], stop_at: str | None = None) -> list[str]:
    """Plays the interview; unscripted steps answer "No" (or the info/confirm default)."""
    answers: dict[str, Answer] = {}
    keys: list[str] = []
    for _ in range(200):
        step = next_step(A, answers)
        if step is None or step.key == stop_at:
            return keys
        keys.append(step.key)
        scripted = script.get(step.key) or script.get(step.key.split(":")[0])
        if scripted is None:
            scripted = {"info": Answer(value="visto"), "confirm": Answer(value="sigue_igual")}.get(
                step.kind, Answer(value="no")
            )
        answers[step.key] = scripted
    raise AssertionError("the interview did not end")


def test_age_then_s1_and_s4_come_first() -> None:
    assert _walk({"AGE": ADULT}, stop_at="Q02") == ["AGE", "S1@start", "S4@start", "Q01"]


def test_a_yes_to_s1_at_the_start_ends_the_interview() -> None:
    assert _walk({"AGE": ADULT, "S1@start": Answer(value="si")}) == ["AGE", "S1@start"]


def test_a_yes_to_s4_at_the_end_ends_the_interview_before_z1() -> None:
    keys = _walk(
        {"AGE": ADULT, "S4@confirm": Answer(value="ha_cambiado"), "S4@end": Answer(value="si")}
    )
    assert keys[-1] == "S4@end"
    assert "Z1" not in keys


def test_a_minor_is_not_interviewed() -> None:
    assert _walk({"AGE": Answer(value=15)}) == ["AGE"]


def test_unknown_age_is_clarified_once_then_stops() -> None:
    unknown = Answer(absence=NO_LO_SE)
    assert _walk({"AGE": unknown, "AGE@aclarar": unknown}) == ["AGE", "AGE@aclarar"]


def test_a_risk_term_in_the_narrative_asks_s4_at_that_moment() -> None:
    narrative = Answer(value="x", text="A veces pienso en quitarme la vida")
    keys = _walk({"AGE": ADULT, "Q01": narrative}, stop_at="Q02")
    assert keys == ["AGE", "S1@start", "S4@start", "Q01", "S4@exception:Q01"]


def test_risk_terms_ignore_case_and_accents() -> None:
    assert "S4" in risk_hits(A, "QUITARME LA VIDA")
    assert risk_hits(A, None) == {}
    assert risk_hits(A, "Duermo mal desde hace meses") == {}


def test_a_positive_q11_asks_s2_now_and_not_again_at_the_end() -> None:
    keys = _walk({"AGE": ADULT, "Q11": Answer(value="dormido_sin_querer")})
    assert keys[keys.index("Q11") + 1] == "S2@ask_now:Q11"
    assert "S2@confirm" in keys and "S2@end" not in keys


def test_s1_and_s4_are_confirmed_at_the_end_not_asked_again() -> None:
    keys = _walk({"AGE": ADULT})
    assert {"S1@confirm", "S4@confirm", "S2@end", "S3@end"} <= set(keys)
    assert "S1@end" not in keys and "S4@end" not in keys
    assert keys[-2:] == ["Z1", "Z2"]


def test_a_changed_answer_at_confirmation_is_asked_again() -> None:
    keys = _walk({"AGE": ADULT, "S1@confirm": Answer(value="ha_cambiado")})
    assert keys[keys.index("S1@confirm") + 1] == "S1@end"


def test_unknown_duration_is_clarified_once() -> None:
    unknown = Answer(absence=NO_LO_SE)
    keys = _walk({"AGE": ADULT, "Q03": unknown, "Q03@aclarar": unknown})
    assert keys.count("Q03@aclarar") == 1


def test_prefer_not_to_answer_is_never_pressed() -> None:
    declined = Answer(absence=PREFIERO)
    keys = _walk({"AGE": ADULT, "Q03": declined, "Q05": declined})
    assert "Q03@aclarar" not in keys and "Q05@aclarar" not in keys


def test_a_core_answer_is_not_asked_again_inside_its_branch() -> None:
    keys = _walk({"AGE": ADULT, "Q16": Answer(value="si"), "Q17": Answer(value="si")})
    assert "P1" not in keys and "N1" not in keys
    assert "P2" in keys and "N2" in keys


def test_closed_branches_are_not_asked() -> None:
    keys = _walk(
        {"AGE": ADULT, "Q08": Answer(value=[]), "Q15": Answer(value=[]), "Q13": Answer(value="si")}
    )
    asked_stages = {A.step(k.split("@")[0]).stage for k in keys}
    assert not asked_stages & {"I", "R", "H", "D", "P", "N"}


def test_unknown_never_closes_a_branch() -> None:
    # D-12: "No lo sé" in Q15 keeps the breathing branch open.
    keys = _walk({"AGE": ADULT, "Q15": Answer(absence=NO_LO_SE)})
    assert "R1" in keys and "R3" in keys


def test_a_no_to_i1_ends_branch_i() -> None:
    keys = _walk({"AGE": ADULT, "Q08": Answer(value=["despertares"]), "I1": Answer(value="no")})
    assert "I1" in keys and "I2" not in keys


# --- p. 10: «S2: primero advertencia; seguir solo si está en un lugar seguro» ---

DROWSY = {"AGE": ADULT, "Q11": Answer(value="dormido_sin_querer"), "S2@ask_now": Answer(value="si")}


def test_an_s2_yes_brings_the_warning_and_the_safe_place_question_at_once() -> None:
    keys = _walk(DROWSY | {"S2_seguro": Answer(value="si")})
    at = keys.index("S2@ask_now:Q11")
    assert keys[at + 1 : at + 3] == ["S2_aviso", "S2_seguro"]
    assert keys.count("S2_aviso") == 1 and keys.count("S2_seguro") == 1
    assert keys[-2:] == ["Z1", "Z2"]


def test_the_warning_also_follows_an_s2_yes_from_the_narrative() -> None:
    narrative = Answer(value="x", text="Soy camionero y conduzco de noche")
    keys = _walk(
        {"AGE": ADULT, "Q01": narrative, "S2@exception": Answer(value="si")}, stop_at="Q02"
    )
    assert keys[-3:] == ["S2@exception:Q01", "S2_aviso", "S2_seguro"]


def test_not_being_in_a_safe_place_pauses_the_interview() -> None:
    for unsafe in (Answer(value="no"), Answer(absence=NO_LO_SE), Answer(absence=PREFIERO)):
        keys = _walk(DROWSY | {"S2_seguro": unsafe})
        assert keys[-1] == "S2_seguro", unsafe


def test_an_s2_no_brings_no_warning() -> None:
    keys = _walk({"AGE": ADULT, "Q11": Answer(value="dormido_sin_querer")})
    assert "S2_aviso" not in keys and "S2_seguro" not in keys
