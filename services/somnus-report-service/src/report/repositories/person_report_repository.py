"""Persistence for the person's AI-written report (`person_reports`, §8).

Write-once: a second write for the same assessment and language is ignored, so
two concurrent first views cannot both store a different text.
"""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from report.application.narrative import PROMPT_VERSION
from report.infrastructure.models import PersonReportRow
from report.schemas.narrative import NarrativeDTO


class PersonReportRepositorySql:
    def __init__(self, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory

    def get(self, assessment_id: str, locale: str) -> NarrativeDTO | None:
        with self._session_factory() as session:
            row = session.get(PersonReportRow, (assessment_id, locale))
            return None if row is None else NarrativeDTO.model_validate_json(row.narrative)

    def put(
        self,
        assessment_id: str,
        locale: str,
        narrative: NarrativeDTO,
        *,
        content_version: str,
        model_id: str,
        input_hash: str,
    ) -> None:
        with self._session_factory() as session:
            session.add(
                PersonReportRow(
                    assessment_id=assessment_id,
                    locale=locale,
                    content_version=content_version,
                    model_id=model_id[:64],
                    prompt_version=PROMPT_VERSION,
                    input_hash=input_hash,
                    narrative=narrative.model_dump_json(by_alias=True),
                )
            )
            try:
                session.commit()
            except IntegrityError:
                # Someone else wrote it first: theirs stands.
                session.rollback()
