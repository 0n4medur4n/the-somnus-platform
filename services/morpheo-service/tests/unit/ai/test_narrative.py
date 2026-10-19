"""The 12 vignettes in narrative mode, from recorded model outputs (no live call).

The final result must be the full run's, once the person has confirmed; the
questions the narrative already answered are skipped; a wrong proposal is
always on a confirmation screen before any rule could read it.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from morpheo.ai.narrative import compare, recorded_provider
from morpheo.ai.pipeline import AiExtractor
from morpheo.ai.prompts import PROMPT_VERSION
from morpheo.ai.provider import FixtureProvider, recording_key
from morpheo.ai.pseudonymise import pseudonymise
from morpheo.ai.quality import score
from morpheo.ai.record import RECORDINGS_FILE, GoldProvider, load_gold, record
from morpheo.funnel.ai_steps import CONFIRM_KIND
from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.interview import Answer, next_step
from morpheo.funnel.rules import evaluate
from morpheo.funnel.vignettes import load_vignettes, run_vignette
from morpheo.instruments.definitions import load_registry
from morpheo.settings.config import Settings

A = funnel_artifact()
GOLD = load_gold()
VIGNETTES = load_vignettes()
REGISTRY = load_registry(Settings(_env_file=None))
PROVIDER, SOURCE = recorded_provider()


@pytest.mark.parametrize("vignette", VIGNETTES, ids=lambda v: v["id"])
def test_narrative_mode_gives_the_full_runs_result(vignette: dict[str, Any]) -> None:
    c = compare(vignette, PROVIDER, GOLD, A, REGISTRY)
    assert c.identical, c.differences
    assert c.failed_calls == ()
    assert c.narrative_steps <= c.full_steps + 4  # a confirmation screen costs a step


SKIPPED = {
    "FT-1": ("Q03", "Q08", "I2"),
    "FT-2": ("Q03", "Q08", "Q15", "I2"),
    "FT-5": ("Q15", "R2a", "R2c", "R6"),
    "FT-6": ("Q08", "I2"),
    "FT-8": ("Q16",),
    "V-12": ("Q03", "Q08", "Q15"),
}


@pytest.mark.parametrize(("vignette_id", "skipped"), SKIPPED.items())
def test_what_the_narrative_said_is_not_asked_again(
    vignette_id: str, skipped: tuple[str, ...]
) -> None:
    vignette = next(v for v in VIGNETTES if v["id"] == vignette_id)
    assert compare(vignette, PROVIDER, GOLD, A, REGISTRY).skipped == skipped


def test_bipolarity_said_in_q14_adapts_the_therapy_only_through_the_confirmation() -> None:
    ft6 = next(v for v in VIGNETTES if v["id"] == "FT-6")
    extractor = AiExtractor(PROVIDER)

    def extract(a: Any, answers: Any, key: str, text: str) -> Any:
        call = extractor.process(a, answers, key, text)
        return None if call is None else call.record

    kept = run_vignette(ft6, A, REGISTRY, extract=extract)
    assert "ADAPTAR_TERAPIA" in kept.result.flags
    removed = run_vignette(
        {**ft6, "narrative_decisions": {"Q14.bipolaridad": "quitado"}}, A, REGISTRY, extract=extract
    )
    assert "ADAPTAR_TERAPIA" not in removed.result.flags


def test_an_unsure_safety_screen_waits_for_the_closing_block() -> None:
    """V-11's «No puedo con mi vida» is "dudoso": nothing is asked at that moment
    (owner decision 19/10/2026); S1-S4 come at the end as for everyone."""
    v11 = next(v for v in VIGNETTES if v["id"] == "V-11")
    c = compare(v11, PROVIDER, GOLD, A, REGISTRY)
    assert c.ai_safety == ()


def test_the_recordings_match_the_prompt_version_and_the_pseudonymiser() -> None:
    data = json.loads(RECORDINGS_FILE.read_text(encoding="utf-8"))
    assert data["prompt_version"] == PROMPT_VERSION
    keys = {recording_key(PROMPT_VERSION, pseudonymise(e["text"]).text) for e in GOLD}
    assert keys == set(data["recordings"]), "re-record: python -m morpheo.ai.record"
    if data["source"] == "stand-in":
        regenerated, failures = record(GOLD, GoldProvider(GOLD))
        assert failures == []
        assert {k: v["output"] for k, v in regenerated.items()} == {
            k: v["output"] for k, v in data["recordings"].items()
        }


def test_quality_is_scored_per_field_and_every_risk_text_is_flagged() -> None:
    quality = score(A, GOLD, PROVIDER, SOURCE)
    assert quality.failed_calls == []
    assert quality.risk_flagged == quality.risk_stated == 6
    assert {"Q03", "Q08", "Q15", "Q14.bipolaridad"} <= set(quality.fields)


def _wrong_outputs() -> FixtureProvider:
    """Deliberately wrong outputs (test data, not a model): values the texts do not say."""
    data = json.loads(RECORDINGS_FILE.read_text(encoding="utf-8"))
    recordings = {}
    for key, entry in data["recordings"].items():
        output = json.loads(json.dumps(entry["output"]))
        for item in output["items"]:
            if item["id"] == "Q03":
                item["value"] = {"amount": 3, "unit": "semanas"}
            if item["id"] == "Q08":
                item["value"] = ["despertar_precoz"]
        recordings[key] = {**entry, "output": output}
    return FixtureProvider(recordings, "wrong-on-purpose")


def test_every_wrong_proposal_is_on_a_confirmation_screen_before_any_rule_reads_it() -> None:
    wrong = _wrong_outputs()
    quality = score(A, GOLD, wrong, "wrong-on-purpose")
    assert len(quality.wrong) >= 10
    by_text = {e["set"] + e["source"]: e for e in GOLD}
    for mistake in quality.wrong:
        entry = by_text[mistake["where"].replace(" ", "")]
        answers = {
            "AGE": Answer(value=40),
            "S1@start": Answer(value="no"),
            "S4@start": Answer(value="no"),
            "Q01": Answer(value=entry["text"], text=entry["text"]),
        }
        call = AiExtractor(wrong).process(A, answers, "Q01", entry["text"])
        assert call is not None
        answers["Q01#ia"] = Answer(value=call.record.to_json())
        before = evaluate(A, answers)
        step = next_step(A, answers)
        while step is not None and step.kind != CONFIRM_KIND:
            answers[step.key] = Answer(value="no")
            step = next_step(A, answers)
        assert step is not None and step.key == "Q01#confirmacion"
        # Unconfirmed, the wrong value changes nothing.
        assert evaluate(A, answers).texts == before.texts


def test_with_the_wrong_outputs_a_careful_person_still_gets_the_full_runs_result() -> None:
    wrong = _wrong_outputs()
    for vignette in VIGNETTES:
        c = compare(vignette, wrong, GOLD, A, REGISTRY)
        assert c.identical, (vignette["id"], c.differences)
        removed = [i for i in c.extracted if i.decision == "quitado"]
        if vignette["id"] in ("FT-1", "FT-2", "V-12"):
            assert removed, vignette["id"]
