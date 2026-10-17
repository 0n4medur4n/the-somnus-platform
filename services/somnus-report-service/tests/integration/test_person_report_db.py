"""The person's report store against a real MySQL (build plan §19)."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import delete
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from report.infrastructure.models import PersonReportRow
from report.repositories.person_report_repository import PersonReportRepositorySql
from report.schemas.narrative import NarrativeDTO


def _narrative(summary: str) -> NarrativeDTO:
    return NarrativeDTO.model_validate(
        {
            "summary": summary,
            "whatToDo": ["Pide consulta."],
            "patterns": [],
            "recommendations": [],
            "prepare": [],
        }
    )


@pytest.fixture
def repo(engine: Engine) -> Iterator[PersonReportRepositorySql]:
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with Session(engine) as session:
        session.execute(delete(PersonReportRow))
        session.commit()
    yield PersonReportRepositorySql(factory)
    with Session(engine) as session:
        session.execute(delete(PersonReportRow))
        session.commit()


def test_written_once_per_language_and_the_first_is_the_original(
    repo: PersonReportRepositorySql,
) -> None:
    store = {"content_version": "1.4", "model_id": "gpt-6-luna", "input_hash": "0" * 64}
    repo.put("a1", "es", _narrative("primero"), **store)
    repo.put("a1", "es", _narrative("segundo"), **store)  # ignored: write-once
    repo.put("a1", "ca", _narrative("traducido"), **store, translated_from="es")

    assert repo.get("a1", "es") == _narrative("primero")
    assert repo.get("a1", "ca") == _narrative("traducido")
    assert repo.get("a1", "fr") is None
    original = repo.original("a1")
    assert original is not None and original[0] == "es"
    assert repo.original("nobody") is None
