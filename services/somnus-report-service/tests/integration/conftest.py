"""Database fixtures for the integration tests (build plan §19: real MySQL).

The engine points at `somnus_reporting` (docker-compose locally, a MySQL service
in CI) and the fixture migrates it to head. Each test that writes cleans up after
itself so the small corpus table stays deterministic across tests.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from report.settings.config import load_settings


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    command.upgrade(Config("alembic.ini"), "head")
    eng = create_engine(load_settings().database_url, pool_pre_ping=True)
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture
def db_session(engine: Engine) -> Iterator[Session]:
    with Session(engine) as session:
        yield session
