"""The AI is on in every language (owner decision 2026-11-25).

A Catalan, English or French narrative goes through the same pipeline as a
Spanish one (pseudonymised first, the interview's own questions in the prompt),
and the confirmation screen reads in the interview's language.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from morpheo.ai.pipeline import AiExtractor
from morpheo.ai.record import GoldProvider
from morpheo.funnel.artifact import SPANISH
from morpheo.funnel.extraction import Q14_TEXT_PARTS
from morpheo.funnel.locales import bundle
from morpheo.infrastructure.models import (
    Base,
    FunnelAnswer,
    FunnelCase,
    FunnelCaseAccess,
    FunnelCaseChange,
    FunnelCaseRecord,
    FunnelSession,
)
from morpheo.main import create_app
from morpheo.settings.config import Settings

BASE = "/internal/v1/funnel"
NO_RISK = {"S1": "no", "S4": "no", "S2": "no"}
NARRATIVES = {
    "ca": ("Des de fa uns sis mesos em desperto gairebé cada nit.", "Des de fa uns sis mesos"),
    "en": (
        "For about six months I have been waking up almost every night.",
        "For about six months",
    ),
    "fr": (
        "Depuis environ six mois, je me réveille presque toutes les nuits.",
        "Depuis environ six mois",
    ),
}


def _gold() -> list[dict[str, Any]]:
    return [
        {
            "set": f"ia-{locale}",
            "source": "Q01",
            "text": text,
            "items": [{"id": "Q03", "value": {"amount": 6, "unit": "meses"}, "evidence": evidence}],
            "risk": NO_RISK,
        }
        for locale, (text, evidence) in NARRATIVES.items()
    ]


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app(Settings(_env_file=None, FUNNEL_LOCALES="es,ca,en,fr"))
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
    app.state.ai = AiExtractor(GoldProvider(_gold()))
    with TestClient(app) as test_client:
        yield test_client


def _ok(client: TestClient, state: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    response = client.post(f"{BASE}/sessions/{state['sessionId']}/answers", json=body)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


@pytest.mark.parametrize("locale", ["ca", "en", "fr"])
def test_the_ai_reads_the_narrative_in_every_language(client: TestClient, locale: str) -> None:
    lang = bundle(locale).artifact.lang
    state = client.post(f"{BASE}/sessions", json={"consentGiven": True, "locale": locale}).json()
    state = _ok(client, state, {"key": "AGE", "value": 52})
    state = _ok(client, state, {"key": "SEX", "value": "hombre"})
    state = _ok(client, state, {"key": "Q01", "value": NARRATIVES[locale][0]})
    step = state["step"]
    # The model was called and proposed Q03: the person confirms it first.
    assert step["key"] == "Q01#confirmacion"
    assert (step["text"], step["note"]) == (lang.confirm_text, lang.confirm_question)
    (item,) = step["extraction"]["items"]
    assert item["question"] == bundle(locale).artifact.step("Q03").text
    assert item["answer"] == f"6 {lang.units['meses'][1]}"
    assert item["evidence"] == NARRATIVES[locale][1]


def test_spanish_keeps_its_wording_and_q14_parts() -> None:
    assert SPANISH.confirm_text == "Por lo que nos ha contado, entendemos:"
    assert SPANISH.confirm_question == "¿Es correcto?"
    assert dict(Q14_TEXT_PARTS) == dict(SPANISH.q14_parts)


@pytest.mark.parametrize("locale", ["ca", "en", "fr"])
def test_every_language_names_the_q14_parts(locale: str) -> None:
    lang = bundle(locale).artifact.lang
    assert set(lang.q14_parts) == set(SPANISH.q14_parts)
    assert lang.q14_question and lang.confirm_text and lang.confirm_question
