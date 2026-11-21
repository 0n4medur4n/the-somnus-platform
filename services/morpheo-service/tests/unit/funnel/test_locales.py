"""The same interview in Catalan, English and French (owner decision 21/11/2026).

Only the words change: steps, keys, rules and results are the Spanish ones, the
final text still adds nothing beyond the engine (v0.2 p. 14), and Catalan keeps
the clinical lead's own wording where his edition writes it.
"""

from __future__ import annotations

import copy
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from morpheo.funnel.artifact import FunnelArtifactError, funnel_artifact
from morpheo.funnel.display import answer_label
from morpheo.funnel.informe import build
from morpheo.funnel.interview import Answer, Interview, risk_hits
from morpheo.funnel.locales import (
    LOCALES,
    bundle,
    enabled_locales,
    load_overlay,
    localize_artifact,
)
from morpheo.funnel.render import question_text
from morpheo.funnel.rules import evaluate
from morpheo.funnel.vignettes import (
    answer_request,
    load_vignettes,
    run_vignette,
    scripted_answer,
)
from morpheo.infrastructure.models import (
    Base,
    FunnelAnswer,
    FunnelCase,
    FunnelCaseAccess,
    FunnelCaseChange,
    FunnelCaseRecord,
    FunnelSession,
)
from morpheo.instruments.definitions import load_registry
from morpheo.main import create_app
from morpheo.settings.config import Settings

OTHERS = ("ca", "en", "fr")
# The typographic apostrophe of the Catalan and French texts (U+2019).
RSQ = chr(0x2019)
VIGNETTES = load_vignettes()
BASE = "/internal/v1/funnel"


# --- the artifacts ---


@pytest.mark.parametrize("locale", OTHERS)
def test_every_language_has_the_same_steps_keys_and_templates(locale: str) -> None:
    es, other = bundle("es").artifact, bundle(locale).artifact
    assert other.locale == locale
    assert [(s.id, s.stage, s.type) for s in other.steps] == [
        (s.id, s.stage, s.type) for s in es.steps
    ]
    for mine, spanish in zip(other.steps, es.steps, strict=True):
        assert [o.key for o in mine.options] == [o.key for o in spanish.options], mine.id
        assert [o.key for o in mine.fields] == [o.key for o in spanish.fields], mine.id
        assert mine.text, mine.id
    assert set(other.templates) == set(es.templates)
    assert (other.content_version, other.rules_version) == (es.content_version, es.rules_version)


def test_catalan_questions_are_the_clinical_leads_own_words() -> None:
    """Jesús's plain-language edition, 21/11/2026: R4, R6 and the age, literally."""
    ca = bundle("ca").artifact
    assert ca.step("AGE").text == "Quina edat té?"
    assert ca.step("R4").text.startswith("Li han diagnosticat alguna malaltia del cor")
    assert ca.step("R6").text.startswith("Si li han fet un estudi respiratori nocturn a casa")
    assert ca.step("Z1").text == "Pel que m" + RSQ + "explica, [resumen]. Ho he entès bé?"
    assert ca.templates["T_PSG"].startswith("«Per [motivo concreto], convé que el visiti")


def test_a_catalan_text_that_is_not_in_the_edition_is_refused() -> None:
    ov = copy.deepcopy(load_overlay("ca"))
    ov["steps"]["Q01"]["text"] = "Què li passa quan dorm?"
    with pytest.raises(FunnelArtifactError, match="not literally in Q01"):
        localize_artifact(funnel_artifact(), ov)


def test_a_catalan_screen_without_a_source_must_say_why() -> None:
    ov = copy.deepcopy(load_overlay("ca"))
    del ov["steps"]["H3b"]["draft"]
    with pytest.raises(FunnelArtifactError, match="neither verbatim nor a draft"):
        localize_artifact(funnel_artifact(), ov)


@pytest.mark.parametrize("locale", OTHERS)
def test_an_overlay_that_leaves_a_step_or_a_label_out_is_refused(locale: str) -> None:
    ov = copy.deepcopy(load_overlay(locale))
    del ov["steps"]["Q12"]
    with pytest.raises(FunnelArtifactError, match="steps missing"):
        localize_artifact(funnel_artifact(), ov)
    ov = copy.deepcopy(load_overlay(locale))
    del ov["steps"]["SEX"]["options"]["hombre"]
    with pytest.raises(FunnelArtifactError, match="labels must name exactly"):
        localize_artifact(funnel_artifact(), ov)


def test_unknown_languages_in_the_setting_stop_the_service() -> None:
    assert enabled_locales("es,ca, en ,fr") == frozenset(LOCALES)
    assert enabled_locales("") == frozenset({"es"})
    with pytest.raises(ValueError, match="unknown languages"):
        enabled_locales("es,de")


# --- same answers, same result, every language ---


def _answers(vignette: dict[str, Any]) -> dict[str, Answer]:
    """The answers the vignette gives, played in Spanish."""
    es = bundle("es").artifact
    answers: dict[str, Answer] = {}
    from morpheo.funnel.interview import next_step

    for _ in range(200):
        step = next_step(es, answers)
        if step is None:
            if "T_HABITOS.cambio" in vignette.get("answers", {}):
                answers["T_HABITOS.cambio"] = Answer(value=vignette["answers"]["T_HABITOS.cambio"])
            return answers
        answers[step.key] = scripted_answer(vignette, step, answers)[0]
    raise AssertionError("did not finish")


@pytest.mark.parametrize("locale", OTHERS)
@pytest.mark.parametrize("vignette", VIGNETTES, ids=lambda v: v["id"])
def test_every_vignette_gives_the_spanish_result_in_every_language(
    vignette: dict[str, Any], locale: str
) -> None:
    answers = _answers(vignette)
    es, other = bundle("es"), bundle(locale)
    spanish = evaluate(es.artifact, answers)
    # evaluate() refuses a text with words from outside the language's artifacts.
    mine = evaluate(other.artifact, answers)
    assert mine.accion_principal == spanish.accion_principal
    assert mine.rule_ids == spanish.rule_ids
    assert mine.flags == spanish.flags
    assert [t for t, _ in mine.texts] == [t for t, _ in spanish.texts]
    assert all(text for _, text in mine.texts)
    assert mine.phrase_ids == spanish.phrase_ids
    report = build(
        other.artifact, other.catalogue, other.informe, Interview(other.artifact, answers), mine
    )
    spanish_report = build(
        es.artifact, es.catalogue, es.informe, Interview(es.artifact, answers), spanish
    )
    assert (report is None) == (spanish_report is None)
    if report is not None and spanish_report is not None:
        assert report.layout == spanish_report.layout
        assert bool(report.headline) == bool(spanish_report.headline)
        assert bool(report.summary) == bool(spanish_report.summary)
        assert len(report.sources) == len(spanish_report.sources)
    if "Z1" in answers:
        z1, _ = question_text(other.artifact.step("Z1"), Interview(other.artifact, answers))
        assert "[" not in z1


def test_the_spanish_run_is_unchanged_by_the_languages() -> None:
    for vignette in VIGNETTES:
        assert not run_vignette(vignette).failures, vignette["id"]


@pytest.mark.parametrize(
    ("locale", "text", "question"),
    [
        ("ca", "De vegades penso a treure" + RSQ + "m la vida", "S4"),
        ("ca", "Sóc camioner i m" + RSQ + "adormo conduint", "S2"),
        ("en", "Sometimes I think I should kill myself", "S4"),
        ("fr", "Parfois je pense à me tuer", "S4"),
        ("fr", "Je m" + RSQ + "endors au volant", "S2"),
        # The Spanish terms still count in every language.
        ("ca", "pienso en quitarme la vida", "S4"),
    ],
)
def test_risk_terms_in_each_language_ask_the_safety_question(
    locale: str, text: str, question: str
) -> None:
    assert question in risk_hits(bundle(locale).artifact, text)


@pytest.mark.parametrize("locale", OTHERS)
def test_an_answer_reads_in_the_interview_language(locale: str) -> None:
    artifact = bundle(locale).artifact
    sex = artifact.step("SEX")
    labels = {o.key: o.label for o in sex.options}
    assert answer_label(Answer(value="mujer"), sex, "ask", artifact.lang) == labels["mujer"]
    duration = answer_label(
        Answer(value={"value": 6, "unit": "meses"}), artifact.step("Q03"), "ask", artifact.lang
    )
    assert duration == f"6 {artifact.lang.units['meses'][1]}"
    # An option retired on 21/11/2026 still reads in an interview answered before.
    r4 = artifact.step("R4")
    old = answer_label(Answer(value=["insomnio_grave"]), r4, "ask", artifact.lang)
    assert old == {o.key: o.label for o in r4.retired_options}["insomnio_grave"]


# --- over HTTP ---


def _client(**settings: Any) -> TestClient:
    app = create_app(Settings(_env_file=None, **settings))
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[
            m.__table__
            for m in (
                FunnelSession,
                FunnelAnswer,
                FunnelCase,
                FunnelCaseRecord,
                FunnelCaseChange,
                FunnelCaseAccess,
            )
        ],
    )
    app.state.session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    return TestClient(app)


@pytest.fixture
def client() -> Iterator[TestClient]:
    with _client(FUNNEL_LOCALES="es,ca,en,fr", AI_EXTRACTION_ENABLED=False) as test_client:
        yield test_client


def _start(client: TestClient, locale: str | None) -> dict[str, Any]:
    body: dict[str, Any] = {"consentGiven": True}
    if locale is not None:
        body["locale"] = locale
    response = client.post(f"{BASE}/sessions", json=body)
    assert response.status_code == 200, response.text
    state: dict[str, Any] = response.json()
    return state


def test_an_interview_is_held_in_the_language_it_starts_in(client: TestClient) -> None:
    state = _start(client, "ca")
    assert state["locale"] == "ca"
    assert state["step"]["text"] == "Quina edat té?"
    assert state["step"]["unit"] == "anys"
    session = state["sessionId"]
    state = client.post(
        f"{BASE}/sessions/{session}/answers", json={"key": "AGE", "value": 40}
    ).json()
    assert state["step"]["key"] == "SEX"
    assert [o["label"] for o in state["step"]["options"]] == ["Dona", "Home"]
    # Reading it again (another request, another language in the app) changes nothing.
    again = client.get(f"{BASE}/sessions/{session}").json()
    assert again["locale"] == "ca" and again["step"]["text"] == "Quin és el seu sexe?"
    assert again["history"][0]["answer"] == "40 anys"


def test_no_language_and_a_language_not_enabled_are_held_in_spanish() -> None:
    assert _start_text(None, "es,ca") == ("es", "¿Qué edad tiene?")
    with _client(FUNNEL_LOCALES="es,ca") as only_catalan:
        state = _start(only_catalan, "fr")
    assert (state["locale"], state["step"]["text"]) == ("es", "¿Qué edad tiene?")


def _start_text(locale: str | None, enabled: str) -> tuple[str, str]:
    with _client(FUNNEL_LOCALES=enabled) as test_client:
        state = _start(test_client, locale)
    return state["locale"], state["step"]["text"]


def test_an_unknown_language_is_refused_by_the_contract(client: TestClient) -> None:
    response = client.post(f"{BASE}/sessions", json={"consentGiven": True, "locale": "de"})
    assert response.status_code == 422


@pytest.mark.parametrize("locale", ["es", *OTHERS])
def test_the_report_says_who_it_is_about(client: TestClient, locale: str) -> None:
    """Jesús, 21/11/2026: the sex is asked at the start and appears in the final report."""
    vignette = next(v for v in VIGNETTES if v["id"] == "FT-1")
    artifact = bundle(locale).artifact
    registry = load_registry(Settings(_env_file=None))
    state = _start(client, locale)
    local: dict[str, Answer] = {}
    from morpheo.funnel.interview import next_step

    while (step := next_step(artifact, local, registry)) is not None:
        assert state["step"]["key"] == step.key
        answer, _ = scripted_answer(vignette, step)
        body = answer_request(step.key, answer, step.definition)
        state = client.post(f"{BASE}/sessions/{state['sessionId']}/answers", json=body).json()
        local[step.key] = answer
    report = state["result"]["report"]
    assert report["person"] == {"age": 52, "sex": "hombre"}
    spanish = run_vignette(vignette).result
    assert state["result"]["mainAction"] == spanish.accion_principal
    assert [t["template"] for t in state["result"]["texts"]] == [t for t, _ in spanish.texts]
    answered = {a["id"]: a["answer"] for a in report["professional"]["answers"]}
    sex = artifact.step("SEX")
    assert answered["SEX"] == {o.key: o.label for o in sex.options}["hombre"]


def test_a_person_who_did_not_say_their_sex_has_none_in_the_report(client: TestClient) -> None:
    vignette = copy.deepcopy(next(v for v in VIGNETTES if v["id"] == "FT-1"))
    vignette["assumed"]["SEX"] = {"absence": "prefiero_no_responder"}
    answers = _answers(vignette)
    es = bundle("es")
    from morpheo.application.funnel_service import FunnelService

    person = FunnelService._person(Interview(es.artifact, answers))
    assert (person.age, person.sex) == (52, None)
