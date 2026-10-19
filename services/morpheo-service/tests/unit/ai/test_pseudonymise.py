"""Reversible pseudonymisation, measured on the 28 annotated synthetic narratives."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from morpheo.ai.pseudonymise import pseudonymise

CASES = json.loads(
    (Path(__file__).parents[2] / "fixtures" / "ai" / "narratives_28.json").read_text(
        encoding="utf-8"
    )
)


def test_every_narrative_is_restored_exactly() -> None:
    for case in CASES:
        pseudo = pseudonymise(case["text"])
        assert pseudo.restore(pseudo.text) == case["text"], case["id"]


def test_it_hides_at_least_43_of_the_47_identifiers_with_no_false_positive() -> None:
    hidden, total, false_positives = 0, 0, []
    for case in CASES:
        pseudo = pseudonymise(case["text"])
        truth = [value for _, value in case["pii"]]
        for value in truth:
            total += 1
            hidden += value not in pseudo.text
        false_positives += [
            v for _, v in pseudo.mapping if not any(v in t or t in v for t in truth)
        ]
    assert total == 47
    # The 18/10/2026 measurement: 43/47 (Tàrrega, Mercadona, Rumanía and
    # «polígono El Segre» escape). It must not get worse.
    assert hidden >= 43
    assert false_positives == []


def test_direct_identifiers_never_reach_the_model() -> None:
    text = "Escribidme a maria@example.com o al 612 98 76 54; mi DNI es 45678912K."
    pseudo = pseudonymise(text)
    for value in ("maria@example.com", "612 98 76 54", "45678912K"):
        assert value not in pseudo.text


@pytest.mark.parametrize(
    "text",
    [
        "Ronco muy fuerte y tengo la tensión alta.",
        "Vivo solo y me noto con mucho sueño durante el día.",
        "Tomo Orfidal cuando no puedo más, y a veces Dormidina.",
        "Desde hace unos seis meses me despierto casi todas las noches.",
        "Tengo trastorno bipolar y tomo litio",
    ],
)
def test_clinical_words_stay_visible(text: str) -> None:
    """A sentence-initial verb or a medicine is not a name: the model must see it."""
    assert pseudonymise(text).text == text


def test_the_same_name_gets_the_same_marker() -> None:
    pseudo = pseudonymise("Mi mujer Marta dice que ronco. Marta se preocupa.")
    assert pseudo.text.count("[PERSONA_1]") == 2
    assert pseudo.count == 1


def test_a_marker_never_collides_with_what_the_person_wrote() -> None:
    text = "Escribí [PERSONA_1] por error. Mi hermano Iñaki ronca."
    pseudo = pseudonymise(text)
    assert pseudo.restore(pseudo.text) == text
    assert "Iñaki" not in pseudo.text
