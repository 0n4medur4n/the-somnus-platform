"""The 12 draft vignettes run green through the v2.0 engine, end to end."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from morpheo.funnel.catalogue import funnel_catalogue
from morpheo.funnel.vignettes import format_run, load_vignettes, main, run_vignette

VIGNETTES = load_vignettes()
# The clinical lead's own marker, en dash included.
DRAFT = "BORRADOR \N{EN DASH} Jesús las corrige"


def _vignette(vignette_id: str) -> dict[str, Any]:
    return next(v for v in VIGNETTES if v["id"] == vignette_id)


def test_there_are_twelve_drafts_marked_for_the_clinical_lead() -> None:
    assert len(VIGNETTES) == 12
    assert all(v["status"] == DRAFT for v in VIGNETTES)
    assert [v["id"] for v in VIGNETTES[:8]] == [f"FT-{n}" for n in range(1, 9)]


@pytest.mark.parametrize("vignette", VIGNETTES, ids=lambda v: v["id"])
def test_vignette_runs_as_expected(vignette: dict[str, Any]) -> None:
    run = run_vignette(vignette)
    assert run.passed, run.failures


def _own_words(vignette: dict[str, Any]) -> list[str]:
    words = [vignette["narrative"]]
    for spec in vignette["answers"].values():
        if isinstance(spec, dict) and isinstance(spec.get("text"), str):
            words.append(spec["text"])
    return words


@pytest.mark.parametrize("vignette", VIGNETTES, ids=lambda v: v["id"])
def test_the_final_text_never_quotes_the_person(vignette: dict[str, Any]) -> None:
    run = run_vignette(vignette)
    for _, text in run.result.texts:
        assert "sin dato" not in text and "[" not in text
        for words in _own_words(vignette):
            assert words not in text
            assert words[:25] not in text


@pytest.mark.parametrize("vignette", VIGNETTES, ids=lambda v: v["id"])
def test_z1_shows_a_summary_not_a_placeholder(vignette: dict[str, Any]) -> None:
    for step in run_vignette(vignette).asked:
        if step.key == "Z1":
            assert "[resumen]" not in step.question
            assert step.question.startswith("Esto es lo que he entendido: ")


def test_a_run_is_deterministic() -> None:
    first, second = run_vignette(VIGNETTES[0]), run_vignette(VIGNETTES[0])
    assert first.result == second.result
    assert first.asked == second.asked


def test_suicidal_ideation_stops_early_with_112_and_024() -> None:
    run = run_vignette(_vignette("V-09"))
    assert run.result.stopped_by == "S4"
    text = dict(run.result.texts)["T_SEGURIDAD"]
    assert "112" in text and "024" in text
    # The patient sees the drafted action, never v0.2's instruction to the system.
    assert "Activar ruta de crisis" not in text
    assert "SEG-S4" in run.phrase_ids


def test_the_drowsy_driver_gets_the_drafted_warning_before_the_template() -> None:
    run = run_vignette(_vignette("V-10"))
    templates = [t for t, _ in run.result.texts]
    assert templates.index("S2_aviso") == templates.index("T_SOMNOLENCIA") - 1
    assert dict(run.result.texts)["S2_aviso"] == funnel_catalogue().drafts["S2_aviso"].text
    assert "PENDIENTE" not in " ".join(text for _, text in run.result.texts)


def test_a_wrong_expectation_is_reported() -> None:
    vignette = _vignette("FT-1") | {
        "expected": {"accion_principal": "EMERGENCIA", "templates_include": ["T_PSG"]}
    }
    run = run_vignette(vignette)
    assert not run.passed
    assert len(run.failures) == 2
    assert "FALLA" in format_run(run)


def test_the_cli_prints_text(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--case", "FT-1"]) == 0
    out = capsys.readouterr().out
    assert "FT-1" in out and "1/1 viñetas como se esperaba" in out


def test_the_cli_prints_json(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--case", "FT-8", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload[0]["id"] == "FT-8"
    assert payload[0]["passed"] is True


def test_the_cli_fails_when_a_vignette_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    broken = _vignette("FT-1") | {"expected": {"accion_principal": "EMERGENCIA"}}
    cases = tmp_path / "cases.json"
    cases.write_text(json.dumps({"vignettes": [broken]}, ensure_ascii=False), encoding="utf-8")
    assert main(["--file", str(cases)]) == 1
    assert "0/1" in capsys.readouterr().out


def test_the_driver_sees_the_warning_in_the_interview_before_continuing() -> None:
    run = run_vignette(_vignette("V-10"))
    keys = [a.key for a in run.asked]
    at = keys.index("S2@exception:Q01")
    assert keys[at + 1 : at + 3] == ["S2_aviso", "S2_seguro"]
    drafts = funnel_catalogue().drafts
    assert run.asked[at + 1].question == drafts["S2_aviso"].text
    assert run.asked[at + 2].question == drafts["S2_seguro"].text
    assert run.asked[at + 2].answer == "Sí"


# --- assumed answers: realistic per case, always marked ---


@pytest.mark.parametrize("vignette", VIGNETTES, ids=lambda v: v["id"])
def test_every_answer_is_given_by_the_case_or_explicitly_assumed(vignette: dict[str, Any]) -> None:
    run = run_vignette(vignette)
    assert not set(vignette["answers"]) & set(vignette["assumed"])
    assert [a.key for a in run.asked if a.source == "default"] == []
    for step in run.asked:
        if step.source == "assumed":
            assert step.assumed
    assert any(step.source == "assumed" for step in run.asked)


def test_assumed_answers_are_marked_in_the_text_output() -> None:
    run = run_vignette(_vignette("FT-1"))
    text = format_run(run)
    age = next(a for a in run.asked if a.key == "AGE")
    assert age.source == "assumed"
    assert f"{age.answer} (supuesta)" in text


def test_assumed_answers_differ_between_cases() -> None:
    ages = {v["assumed"].get("AGE") for v in VIGNETTES}
    schedules = {
        json.dumps([v["assumed"].get(f"Q07{s}") for s in "abcd"])
        for v in VIGNETTES
        if "Q07a" in v["assumed"]
    }
    impacts = {v["assumed"].get("Q10", {}).get("text") for v in VIGNETTES if "Q10" in v["assumed"]}
    assert len(ages) == len(VIGNETTES)
    assert len(schedules) >= 9 and len(impacts) >= 9


def test_the_night_driver_sleeps_by_day() -> None:
    answers = _vignette("V-10")["answers"]
    bed, wake = answers["Q07a"]["value"]["acostarse"], answers["Q07c"]["value"]["despertarse"]
    assert bed < "12:00" < wake < "18:00"
