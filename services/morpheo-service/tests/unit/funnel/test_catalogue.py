"""The phrase catalogue: closed, validated, and chosen only by answers."""

from __future__ import annotations

import copy
from typing import Any

import pytest

from morpheo.funnel.artifact import FunnelArtifactError, funnel_artifact
from morpheo.funnel.catalogue import (
    APPROVED_STATUS,
    OWNER_APPROVED,
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


def test_the_whole_catalogue_is_approved_by_the_clinical_lead() -> None:
    assert C.status == APPROVED_STATUS == "APROBADO \N{EN DASH} Jesús, 19/10/2026"


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


def test_the_new_texts_are_approved_too() -> None:
    lead = {"S2_aviso", "S2_seguro", "S2_pausa", "T_RECIENTE"}
    assert set(C.drafts) == lead | {"T_SIN_ORIENTACION"}
    assert all(C.drafts[d].status == APPROVED_STATUS for d in lead)
    assert C.drafts["T_SIN_ORIENTACION"].status == OWNER_APPROVED["T_SIN_ORIENTACION"]
    assert C.lists["accion_seguridad"].status == APPROVED_STATUS


def test_the_owner_approval_counts_for_its_own_text_only() -> None:
    raw = _raw()
    raw["drafts"]["S2_aviso"]["status"] = OWNER_APPROVED["T_SIN_ORIENTACION"]
    with pytest.raises(FunnelArtifactError, match="not approved"):
        parse_catalogue(raw, A)


def test_the_no_orientation_text_cannot_lose_its_approval() -> None:
    raw = _raw()
    raw["drafts"]["T_SIN_ORIENTACION"]["status"] = "BORRADOR"
    with pytest.raises(FunnelArtifactError, match="not approved"):
        parse_catalogue(raw, A)


def test_an_unapproved_text_is_refused() -> None:
    raw = _raw()
    raw["drafts"]["S2_aviso"]["status"] = "BORRADOR"
    with pytest.raises(FunnelArtifactError, match="not approved"):
        parse_catalogue(raw, A)


def test_a_missing_draft_is_refused() -> None:
    raw = _raw()
    del raw["drafts"]["T_RECIENTE"]
    with pytest.raises(FunnelArtifactError, match="drafts missing"):
        parse_catalogue(raw, A)


def test_an_unknown_slot_is_refused() -> None:
    raw = _raw()
    raw["drafts"]["S2_aviso"]["text"] = "Llame al {TELEFONO}."
    with pytest.raises(FunnelArtifactError, match="unknown slot"):
        parse_catalogue(raw, A)


def test_safety_actions_use_the_confirmed_resources() -> None:
    s4 = _selector({"S4@start": Answer(value="si")})
    assert s4.text("accion_seguridad") == (
        "No tiene que pasar por esto a solas. Puede llamar ahora al 024 (línea de atención a la"
        " conducta suicida): es gratuita, confidencial y atiende las 24 horas del día. Si siente"
        " que el peligro es inmediato, llame al 112"
    )
    s1 = _selector({"S1@end": Answer(value="si"), "S3@end": Answer(value="si")})
    assert s1.select("accion_seguridad").ids == ["SEG-S1"]
