"""SQLAlchemy engine factory (build plan §3.5 / ADR 0005: one sync driver).

Synchronous engine, PyMySQL as the only driver. `Base` is the declarative base
for the report service's own tables against `somnus_reporting` (build plan §3.9 /
§8) — the clinical-source corpus it embeds for explanation-only grounding (§3.6b).
The engine is lazy: no connection is opened until the first query, so the render
endpoint still boots and serves without a database.
"""

from __future__ import annotations

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def create_engine_from_url(database_url: str) -> Engine:
    # Cost policy (build plan §2): no eager warm-up of database pools beyond one
    # connection; min instances are zero everywhere.
    return create_engine(database_url, pool_pre_ping=True, pool_size=1, max_overflow=0)
