"""The patient's report and the professional's page: built from the engine, written by no model."""

from __future__ import annotations

import copy
import json
from typing import Any

import pytest

from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.catalogue import funnel_catalogue
from morpheo.funnel.informe import (
    INFORME_FILE,
    InformeError,
    build,
    informe_artifact,
    parse,
    sentences,
)
from morpheo.funnel.interview import Answer, Interview, next_step
from morpheo.funnel.rules import evaluate
from morpheo.funnel.vignettes import load_vignettes, scripted_answer
from morpheo.instruments.definitions import load_registry
from morpheo.settings.config import Settings

A = funnel_artifact()
C = funnel_catalogue()
I = informe_artifact()  # noqa: E741 - the report artifact, as A and C are theirs
REGISTRY = load_registry(Settings(_env_file=None))
RAW = json.loads(INFORME_FILE.read_text(encoding="utf-8"))


def _run(vignette_id: str) -> tuple[Any, Interview, Any]:
    vignette = next(v for v in load_vignettes() if v["id"] == vignette_id)
    answers: dict[str, Answer] = {}
    for _ in range(200):
        step = next_step(A, answers, REGISTRY)
        if step is None:
            break
        answers[step.key], _ = scripted_answer(vignette, step)
    result = evaluate(A, answers, REGISTRY)
    iv = Interview(A, answers)
    return build(A, C, I, iv, result), iv, result


VIGNETTES = [v["id"] for v in load_vignettes()]


def test_the_artifact_is_approved() -> None:
    assert I.approved is True
    report, _, _ = _run("FT-1")
    assert report is not None


@pytest.mark.parametrize("vignette_id", VIGNETTES)
def test_every_report_is_built_from_approved_sentences_only(vignette_id: str) -> None:
    report, _, result = _run(vignette_id)
    if report is None or report.layout == "urgent":
        return
    texts = dict(result.texts)
    # The headline is a sentence of an approved template, word for word.
    for sentence in report.headline + report.secondary:
        assert any(sentence in text for text in texts.values()), sentence
    # The steps are literal v0.2.
    v02 = json.dumps(A.raw["source"], ensure_ascii=False)
    for step in report.steps:
        assert step in v02
    # The help sentences are approved catalogue phrases.
    phrases = [p.text for lst in C.lists.values() for p in lst.phrases]
    for sentence in RAW["ayuda"]["frases"]:
        assert any(sentence.rstrip(".") in p for p in phrases)
    assert report.limits == tuple(RAW["limites"]["frases"])


@pytest.mark.parametrize("vignette_id", [v for v in VIGNETTES if v != "V-09"])
def test_a_standard_report_always_says_what_to_do_first(vignette_id: str) -> None:
    report, _, _ = _run(vignette_id)
    assert report is not None and report.layout == "standard"
    assert report.headline, "no action sentence: the report would open without a recommendation"


def test_an_emergency_report_is_only_the_urgent_message() -> None:
    report, _, result = _run("V-09")
    assert report is not None and report.layout == "urgent"
    assert result.accion_principal == "EMERGENCIA"
    assert not (report.headline or report.summary or report.steps or report.sources)
    assert report.professional is None


def test_the_action_sentence_exists_in_every_approved_template() -> None:
    """A template change that moves its action sentence fails here, not in a report."""
    texts = dict(A.templates) | {k: d.text for k, d in C.drafts.items()}
    for template, wanted in RAW["accion"].items():
        if template.startswith("_") or wanted == "todas":
            continue
        assert template in texts, template
        assert max(wanted) < len(sentences(texts[template])), template


def test_what_the_person_confirmed_is_the_summary_they_saw_in_z1() -> None:
    report, _, _ = _run("FT-1")
    assert report is not None and report.summary is not None
    assert report.summary[0].islower()  # it continues «Esto es lo que he entendido:»
    assert report.summary.endswith(".")
    assert "Esto es lo que he entendido" not in report.summary


def test_the_professionals_page_says_why_and_where_each_answer_came_from() -> None:
    report, _, _ = _run("FT-6")
    assert report is not None and report.professional is not None
    pro = report.professional
    assert pro.main_action == "TERAPIA"
    assert any(row.id == "ADAPTAR_TERAPIA" and "bipolaridad" in row.reasons for row in pro.flags)
    assert any(line.startswith("R07") for line in pro.rules)
    assert pro.narrative
    assert {row.origin for row in pro.answers} <= {"answered", "narrative", "corrected"}


def test_a_safety_question_asked_at_that_moment_is_marked_so() -> None:
    report, _, _ = _run("V-10")
    assert report is not None and report.professional is not None
    whens = {row.when for row in report.professional.safety}
    assert "moment" in whens


def test_unknown_stays_unknown_in_the_professionals_page() -> None:
    report, _, _ = _run("FT-7")
    assert report is not None and report.professional is not None
    answers = {row.id: row.answer for row in report.professional.answers}
    assert answers["Q03"] == "No lo sé"  # never turned into a «No» (R03)


def test_the_sources_are_those_of_v02_p15_and_nothing_else() -> None:
    report, _, _ = _run("FT-2")
    assert report is not None
    items = A.raw["source"]["sources"]["items"]
    assert report.sources and all(line in items for line in report.sources)


def test_no_report_without_a_text_to_show() -> None:
    answers = {"AGE": Answer(value=15)}
    result = evaluate(A, answers, REGISTRY)
    assert build(A, C, I, Interview(A, answers), result) is None


# --- the loader refuses what the approved sources do not say ---


def _tampered(**changes: Any) -> dict[str, Any]:
    raw = copy.deepcopy(RAW)
    for path, value in changes.items():
        node = raw
        *parents, last = path.split(".")
        for key in parents:
            node = node[key]
        node[last] = value
    return raw


@pytest.mark.parametrize(
    "changes",
    [
        {"ayuda.frases": ["Llame al médico de guardia."]},
        {"pasos.diario_y_revision.texto": "Lleve un diario durante un mes."},
        {"ayuda.recursos": ["TELEFONO_INVENTADO"]},
        {"fuentes.T_INSOMNIO": [1, 9]},
    ],
)
def test_the_loader_refuses_text_the_approved_sources_do_not_carry(changes: dict[str, Any]) -> None:
    with pytest.raises(InformeError):
        parse(_tampered(**changes), A, C)


def test_the_loader_refuses_an_unknown_template() -> None:
    raw = _tampered()
    raw["accion"]["T_INVENTADA"] = [0]
    with pytest.raises(InformeError):
        parse(raw, A, C)


# --- the switch ---


def _unsigned() -> Any:
    from morpheo.funnel.informe import InformeArtifact

    return InformeArtifact({**RAW, "meta": {**RAW["meta"], "approved": False}})


def test_the_switch_refuses_an_artifact_that_is_not_approved() -> None:
    from morpheo.funnel.informe import require_approved

    with pytest.raises(InformeError, match="not been signed"):
        require_approved(_unsigned())
    assert require_approved(I) is I


def test_the_service_refuses_to_start_with_the_switch_on_and_an_unsigned_artifact(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import morpheo.main as main

    monkeypatch.setattr(main, "informe_artifact", _unsigned)
    with pytest.raises(InformeError):
        main.create_app(Settings(_env_file=None, REPORT_V3_ENABLED=True))  # type: ignore[call-arg]


def test_the_switch_is_on_by_default_and_can_be_turned_off() -> None:
    assert Settings(_env_file=None).report_v3_enabled is True  # type: ignore[call-arg]
    assert Settings(_env_file=None, REPORT_V3_ENABLED=False).report_v3_enabled is False  # type: ignore[call-arg]
