"""The v2.0 artifact may cut a v0.2 question into screens, never reword it."""

from __future__ import annotations

import copy
from typing import Any

import pytest

from morpheo.funnel.artifact import FunnelArtifactError, funnel_artifact, parse


def _raw() -> dict[str, Any]:
    return copy.deepcopy(funnel_artifact().raw)


def _engine_step(raw: dict[str, Any], step_id: str) -> dict[str, Any]:
    step: dict[str, Any] = next(s for s in raw["engine"]["steps"] if s["id"] == step_id)
    return step


def test_every_step_text_is_a_fragment_of_its_v02_source() -> None:
    artifact = funnel_artifact()
    source = artifact.raw["source"]
    texts = {q["id"]: q["text"] for q in source["questions"]}
    for branch in source["branches"]:
        texts.update({item["id"]: item["text"] for item in branch["items"]})
    texts.update({item["id"]: item["text"] for item in source["safety_and_close"]["items"]})
    checked = 0
    for step in artifact.steps:
        if step.source in texts:
            assert step.text in texts[step.source], step.id
            checked += 1
    assert checked > 40


def test_a_reworded_split_screen_is_refused() -> None:
    raw = _raw()
    _engine_step(raw, "R2a")["fragment"] = "¿Ronca usted a menudo?"
    with pytest.raises(FunnelArtifactError, match="not verbatim"):
        parse(raw)


def test_a_reworded_option_label_is_refused() -> None:
    raw = _raw()
    _engine_step(raw, "Q11")["options"][0]["label"] = "agotamiento"
    with pytest.raises(FunnelArtifactError, match="not verbatim"):
        parse(raw)


def test_an_unknown_source_is_refused() -> None:
    raw = _raw()
    _engine_step(raw, "Q16")["source"] = "Q99"
    with pytest.raises(FunnelArtifactError, match="unknown source"):
        parse(raw)


def test_a_template_override_must_match_the_v02_text() -> None:
    raw = _raw()
    raw["engine"]["template_overrides"][0]["from"] = "texto que no existe"
    with pytest.raises(FunnelArtifactError, match="not found"):
        parse(raw)


def test_the_draft_is_inactive_and_pending_clinical_review() -> None:
    artifact = funnel_artifact()
    assert artifact.raw["meta"]["active"] is False
    assert artifact.raw["meta"]["status"] == "pending_clinical_review"
    assert artifact.content_version == "2.0-draft"
    # D-07, approved by the clinical lead on 18/10/2026.
    assert artifact.engine["resources"]["EMERGENCIA"] == "112"
    # No invented wording: the drowsy-driver message waits for the clinical lead.
    pending = artifact.engine["pending_texts"]["S2_driver_warning"]
    assert pending == "PENDIENTE \N{EN DASH} texto de Jesús"


def test_t_insomnio_extra_sentence_comes_from_its_v02_guidance() -> None:
    sentence = funnel_artifact().templates["T_INSOMNIO.sin_otras_senales"]
    assert sentence
    assert "«" not in sentence and "»" not in sentence
