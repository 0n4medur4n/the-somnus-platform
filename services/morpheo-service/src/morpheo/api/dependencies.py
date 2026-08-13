"""FastAPI dependencies for the assessment endpoints (build plan §20 Checkpoint 10.3).

A per-request SQLAlchemy session (from the app's session factory), the cached
clinical bundle, and an `AssessmentFlow` bound to both. The engine/session
factory live on `app.state` (created in main.create_app); the flow never
outlives a request. Dependencies are exposed as `Annotated` aliases so routes
declare `flow: FlowDep` without calling `Depends` in a default (ruff B008).
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session, sessionmaker

from morpheo.application.assessment_flow import AssessmentFlow
from morpheo.application.events import LoggingEventPublisher
from morpheo.clinical.loader import ClinicalBundle, clinical_bundle


def get_db_session(request: Request) -> Iterator[Session]:
    factory: sessionmaker[Session] = request.app.state.session_factory
    session = factory()
    try:
        yield session
    finally:
        session.close()


def get_bundle() -> ClinicalBundle:
    return clinical_bundle()


SessionDep = Annotated[Session, Depends(get_db_session)]
BundleDep = Annotated[ClinicalBundle, Depends(get_bundle)]


def get_flow(session: SessionDep, bundle: BundleDep) -> AssessmentFlow:
    return AssessmentFlow(session, bundle, LoggingEventPublisher())


FlowDep = Annotated[AssessmentFlow, Depends(get_flow)]
