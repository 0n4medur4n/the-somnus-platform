"""Read access to the seeded clinical reference tables (build plan §14).

Thin repository over the reference rows the seeding migration populated from the
artifacts. Read-only here — the reference data is immutable between content
versions and is only ever replaced by a migration.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from morpheo.infrastructure.models import (
    ClaimRegistryEntry,
    ClinicalModule,
    ClinicalSource,
    CoreQuestion,
    ForbiddenPhrase,
    RoleDefinition,
    SafetyRule,
    WorkflowMeta,
)


class ReferenceRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def workflow_version(self) -> str | None:
        meta = self._session.scalars(select(WorkflowMeta)).first()
        return meta.version if meta is not None else None

    def roles(self) -> list[RoleDefinition]:
        return list(self._session.scalars(select(RoleDefinition)))

    def safety_rules(self) -> list[SafetyRule]:
        return list(self._session.scalars(select(SafetyRule)))

    def modules(self) -> list[ClinicalModule]:
        return list(self._session.scalars(select(ClinicalModule)))

    def clinical_sources(self) -> list[ClinicalSource]:
        return list(self._session.scalars(select(ClinicalSource)))

    def claims(self) -> list[ClaimRegistryEntry]:
        return list(self._session.scalars(select(ClaimRegistryEntry)))

    def core_questions(self) -> list[CoreQuestion]:
        return list(self._session.scalars(select(CoreQuestion)))

    def forbidden_phrases(self) -> list[ForbiddenPhrase]:
        return list(self._session.scalars(select(ForbiddenPhrase)))
