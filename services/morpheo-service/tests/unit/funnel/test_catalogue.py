"""The phrase catalogue: closed, validated, and chosen only by answers."""

from __future__ import annotations

import copy
from typing import Any

import pytest

from morpheo.funnel.artifact import FunnelArtifactError, funnel_artifact
from morpheo.funnel.catalogue import (
    CATALOGUE_STATUS,
    Selector,
    funnel_catalogue,
    parse_catalogue,
)
from morpheo.funnel.interview import NO_LO_SE, Answer, Interview

A = funnel_artifact()
C = funnel_catalogue()


def _raw() -> dict[str, Any]:
    return copy.deepcopy(C.raw)


def _phrase(raw: dict[str, Any], phrase_id: str) -> dict[str, Any]:
    for spec in raw["lists"].values():
        for phrase in spec["phrases"]:
            if phrase["id"] == phrase_id:
                found: dict[str, Any] = phrase
                return found
    raise KeyError(phrase_id)


def _selector(answers: dict[str, Answer], pending: tuple[str, ...] = ()) -> Selector:
    return Selector(C, Interview(A, answers), pending)


def test_the_whole_catalogue_is_a_draft_for_the_clinical_lead() -> None:
    assert C.status == CATALOGUE_STATUS == "BORRADOR \N{EN DASH} Jesús lo aprueba"


def test_a_template_placeholder_without_a_list_is_refused() -> None:
    raw = _raw()
    del raw["placeholders"]["T_PSG"]
    with pytest.raises(FunnelArtifactError, match="without a phrase list"):
        parse_catalogue(raw, A)


def test_a_condition_on_an_unknown_question_is_refused() -> None:
    raw = _raw()
    _phrase(raw, "DIF-01")["when"] = {"q": "Q99", "has": "dormirse"}
    with pytest.raises(FunnelArtifactError, match="unknown question"):
        parse_catalogue(raw, A)


def test_a_condition_on_an_unknown_option_is_refused() -> None:
    raw = _raw()
    _phrase(raw, "DIF-01")["when"] = {"q": "Q08", "has": "insomnio"}
    with pytest.raises(FunnelArtifactError, match="no option"):
        parse_catalogue(raw, A)


@pytest.mark.parametrize("text", ["le cuesta [algo]", "x" * 200, " le cuesta dormirse"])
def test_a_phrase_must_be_short_and_finished(text: str) -> None:
    raw = _raw()
    _phrase(raw, "DIF-01")["text"] = text
    with pytest.raises(FunnelArtifactError, match="short, finished phrase"):
        parse_catalogue(raw, A)


def test_the_status_cannot_be_dropped() -> None:
    raw = _raw()
    raw["meta"]["status"] = "aprobado"
    with pytest.raises(FunnelArtifactError, match="status"):
        parse_catalogue(raw, A)


def test_difficulties_are_all_listed_in_catalogue_order() -> None:
    selector = _selector({"Q08": Answer(value=["despertar_precoz", "dormirse"])})
    assert (
        selector.text("dificultad") == "le cuesta dormirse y se despierta antes de lo que querría"
    )
    assert selector.used == ["DIF-01", "DIF-03"]


def test_frequency_uses_the_number_given_and_falls_back_to_i3() -> None:
    assert _selector({"Q05": Answer(value=1)}).text("frecuencia") == "1 noche por semana"
    assert _selector({"Q05": Answer(value=4)}).text("frecuencia") == "4 noches por semana"
    unknown = {"Q05": Answer(absence=NO_LO_SE), "I3": Answer(value="si")}
    assert _selector(unknown).text("frecuencia") == "al menos 3 noches por semana"
    assert _selector({"Q05": Answer(absence=NO_LO_SE)}).text("frecuencia") is None


def test_impact_never_uses_the_persons_own_words() -> None:
    answers = {
        "Q10": Answer(value="No puedo con mi vida", text="No puedo con mi vida"),
        "Q11": Answer(value="cansancio"),
        "I2": Answer(value="si"),
    }
    assert _selector(answers).text("impacto") == "esto afecta a su día a día y nota cansancio"


def test_a_sign_inferred_from_an_earlier_answer_is_not_counted_twice() -> None:
    # R1 is inferred from Q15 here, so only the Q15 phrase appears.
    answers = {"Q15": Answer(value=["ahogo"])}
    assert _selector(answers).text("senales_respiratorias") == "despertares con sensación de ahogo"


def test_unknown_complexity_is_a_reason_only_when_the_breathing_branch_opened() -> None:
    closed = _selector({"Q15": Answer(value=[]), "D2a": Answer(value="si")})
    assert closed.select("motivo_psg").ids == ["PSG-08"]
    opened = _selector({"Q15": Answer(value=["ronca_fuerte"])})
    assert opened.select("motivo_psg").ids == ["PSG-06"]


def test_the_persons_choice_of_habit_wins_over_the_default() -> None:
    by_rule = _selector({"H4": Answer(value="si")})
    assert by_rule.text("cambio_habitos") == "proteger un tiempo fijo para descansar"
    chosen = _selector({"H4": Answer(value="si"), "T_HABITOS.cambio": Answer(value="HAB-03")})
    assert chosen.text("cambio_habitos") == "reducir la cafeína, si nota que le influye"
    unknown_choice = _selector({"T_HABITOS.cambio": Answer(value="HAB-99")})
    assert unknown_choice.select("cambio_habitos").ids == ["HAB-00"]


def test_pending_data_is_named_in_plain_words() -> None:
    selector = _selector({}, pending=("S3", "Q03"))
    assert selector.text("dato_pendiente") == (
        "si duerme muy poco varias noches seguidas y aun así tiene una energía fuera de lo"
        " habitual y desde cuándo le ocurre"
    )


def test_the_z1_summary_joins_with_semicolons_and_has_a_fallback() -> None:
    answers = {"Q08": Answer(value=["dormirse"]), "Q03": Answer(value={"value": 2, "unit": "años"})}
    assert _selector(answers).text("resumen") == "le cuesta dormirse; desde hace 2 años"
    assert _selector({}).text("resumen") == (
        "por ahora no ha descrito ninguna dificultad concreta con el sueño"
    )
