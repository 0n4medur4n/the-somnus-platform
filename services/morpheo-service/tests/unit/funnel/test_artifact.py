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
    # Later decisions: the rewordings replace their v0.2 text, additions are new.
    texts.update({r["id"]: r["text"] for r in artifact.engine["source_revisions"]})
    texts.update({a["id"]: a["text"] for a in artifact.engine["additions"]})
    checked = 0
    for step in artifact.steps:
        if step.source in texts and step.draft is None:
            # The only change allowed: the first letter after «¿» when a
            # question is cut from mid-sentence (R4).
            text = step.text
            as_cut = text[:1] + text[1:2].lower() + text[2:] if text.startswith("¿") else text
            assert text in texts[step.source] or as_cut in texts[step.source], step.id
            checked += 1
    assert checked > 40


def test_only_the_splits_v02_asks_for_but_does_not_write_are_drafts() -> None:
    """Q07 «separar cada pregunta» (p. 3) and Q14's breakdown (p. 4), owner
    decision 19/10/2026: these nine screens, and no other, carry a draft text;
    Q07's use only Q07's own words."""
    artifact = funnel_artifact()
    drafts = {s.id: s for s in artifact.steps if s.draft is not None}
    assert set(drafts) == {"Q07a", "Q07b", "Q07c", "Q07d", "Q14a", "Q14b", "Q14c", "Q14d", "Q14e"}
    for step in drafts.values():
        assert "Jesús lo revisa" in (step.draft or ""), step.id
    q07 = artifact.raw["source"]["questions"][6]
    assert q07["id"] == "Q07"
    words = set(q07["text"].replace("¿", " ").replace("?", " ").replace(",", " ").split())
    for suffix in "abcd":
        text = drafts[f"Q07{suffix}"].text
        assert set(text.replace("¿", " ").replace("?", " ").split()) <= words, text


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


def test_v02_is_the_active_flow_content_2_0() -> None:
    # Owner and clinical lead, 19/10/2026: the active flow until Jesús says otherwise.
    artifact = funnel_artifact()
    assert artifact.raw["meta"]["active"] is True
    # 2.3 (21/11/2026): R4 and R6 reworded, SEX added; no rule changed.
    assert (artifact.content_version, artifact.rules_version) == ("2.3", "2.2")
    # D-07, approved by the clinical lead on 18/10/2026.
    assert artifact.engine["resources"]["EMERGENCIA"] == "112"
    # Texts v0.2 does not give are drafts in the phrase catalogue, not here.
    assert "pending_texts" not in artifact.engine


def test_t_insomnio_extra_sentence_comes_from_its_v02_guidance() -> None:
    sentence = funnel_artifact().templates["T_INSOMNIO.sin_otras_senales"]
    assert sentence
    assert "«" not in sentence and "»" not in sentence


def test_z2_asks_only_its_question_not_the_interviewers_instruction() -> None:
    """v0.2 p. 10 writes Z2 as «Explicar posible problema y siguiente paso. ¿Qué le
    facilitaría seguir este plan?»: the first sentence tells the interviewer what to
    do (the result explains it); the person is asked only the second, word for word."""
    z2 = funnel_artifact().step("Z2")
    assert z2.text == "¿Qué le facilitaría seguir este plan?"
    assert "Explicar" not in z2.text


def test_r4_is_the_plain_language_question_of_21_11() -> None:
    """Jesús, 21/11/2026 (plain-language edition, p. 6): R4 asks about a diagnosed or
    followed-up heart or lung disease, stroke and opioids, with five examples;
    «relevante», respiratory weakness and severe insomnia leave this step. The v0.2
    text it replaces stays on record."""
    artifact = funnel_artifact()
    r4 = artifact.step("R4")
    assert r4.text.startswith("¿Le han diagnosticado alguna enfermedad del corazón o de los")
    assert "(tramadol, codeína, buprenorfina, fentanilo o morfina)" in r4.text
    assert "relevante" not in r4.text and "insomnio grave" not in r4.text
    assert [o.key for o in r4.options] == ["cardiopulmonar", "ictus", "opioides"]
    # Retired options only read interviews answered before; they are never offered.
    assert [o.key for o in r4.retired_options] == ["debilidad_respiratoria", "insomnio_grave"]
    revision = next(r for r in artifact.engine["source_revisions"] if r["id"] == "R4")
    assert revision["v02_text"].startswith("Si hay sospecha: ¿hay enfermedad cardiopulmonar")


def test_r6_is_the_plain_language_question_of_21_11() -> None:
    r6 = funnel_artifact().step("R6")
    assert r6.text == (
        "Si le han hecho un estudio respiratorio nocturno en casa, ¿le dijeron que el"
        " resultado era normal, dudoso o no válido por problemas técnicos?"
    )


def test_sex_is_asked_right_after_the_age() -> None:
    artifact = funnel_artifact()
    ids = [s.id for s in artifact.steps]
    assert ids[:3] == ["AGE", "SEX", "Q01"]
    sex = artifact.step("SEX")
    assert (sex.stage, sex.type) == ("start", "single")
    assert [(o.key, o.label) for o in sex.options] == [("mujer", "Mujer"), ("hombre", "Hombre")]


def test_a_revision_must_name_the_v02_text_it_replaces() -> None:
    raw = _raw()
    raw["engine"]["source_revisions"][0]["v02_text"] = "otra cosa"
    with pytest.raises(FunnelArtifactError, match="v02_text"):
        parse(raw)


def test_an_addition_cannot_reuse_a_v02_id() -> None:
    raw = _raw()
    raw["engine"]["additions"][0]["id"] = "Q01"
    with pytest.raises(FunnelArtifactError, match="already has it"):
        parse(raw)
