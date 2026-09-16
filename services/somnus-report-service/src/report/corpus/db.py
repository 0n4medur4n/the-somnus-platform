"""The corpus module's own engine and declarative base (build plan §3.9 / §8).

Deliberately NOT `report.infrastructure.db.Base`. Each logical database has an
independent migration history, so `somnus_content`'s tables must not appear in
`somnus_reporting`'s metadata: sharing a base would let one database's `upgrade`
create the other's tables.
"""

from __future__ import annotations

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase


class CorpusBase(DeclarativeBase):
    pass


def create_corpus_engine(database_url: str) -> Engine:
    # Same cost policy as every other pool here (build plan §2): minimum
    # instances are zero, so no eager warm-up beyond a single connection.
    return create_engine(database_url, pool_pre_ping=True, pool_size=1, max_overflow=0)
