"""SQLAlchemy engine factory.

Synchronous engine, PyMySQL as the only driver (build plan §3.5 / ADR 0005:
one driver, no async driver mixed in). `Base` is the shared declarative
base for Morpheo's own tables against `somnus_morpheo`; it stays empty
until Phase 10.2 (no assessment logic in this checkpoint).
"""

from __future__ import annotations

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def create_engine_from_url(database_url: str) -> Engine:
    # Cost policy (build plan §2): no eager warm-up of database pools
    # beyond one connection; min instances are zero everywhere.
    return create_engine(database_url, pool_pre_ping=True, pool_size=1, max_overflow=0)
