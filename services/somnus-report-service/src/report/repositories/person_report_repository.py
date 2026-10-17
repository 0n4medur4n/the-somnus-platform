"""Persistence for the person's AI-written report (`person_reports`, §8).

Write-once: a second write for the same assessment and language is ignored, so
two concurrent first views cannot both store a different text.
"""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy import select
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

    def original(self, assessment_id: str) -> tuple[str, NarrativeDTO] | None:
        with self._session_factory() as session:
            row = session.scalars(
                select(PersonReportRow)
                .where(
                    PersonReportRow.assessment_id == assessment_id,
                    PersonReportRow.translated_from.is_(None),
                )
                .order_by(PersonReportRow.created_at.asc())
                .limit(1)
            ).first()
            if row is None:
                return None
            return row.locale, NarrativeDTO.model_validate_json(row.narrative)

    def put(
        self,
        assessment_id: str,
        locale: str,
        narrative: NarrativeDTO,
        *,
        content_version: str,
        model_id: str,
        input_hash: str,
        translated_from: str | None = None,
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
                    translated_from=translated_from,
                    narrative=narrative.model_dump_json(by_alias=True),
                )
            )
            try:
                session.commit()
            except IntegrityError:
                # Someone else wrote it first: theirs stands.
                session.rollback()
