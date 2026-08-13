"""The reference migration is reversible (build plan §8 / §19: migrations up AND
down). Down drops the schema; up recreates and reseeds it."""

from __future__ import annotations

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, inspect, text


def _tables(engine: Engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def test_downgrade_then_upgrade_restores_the_seeded_schema(engine: Engine) -> None:
    config = Config("alembic.ini")

    # Full stack down: both the transactional and the reference migrations reverse.
    command.downgrade(config, "base")
    tables = _tables(engine)
    assert "safety_rules" not in tables  # reference schema gone
    assert "assessment_sessions" not in tables  # transactional schema gone

    command.upgrade(config, "head")
    assert {
        "safety_rules",
        "claims_registry",
        "role_definitions",
        "assessment_sessions",
        "assessment_claim_tokens",
        "assessment_snapshots",
    } <= _tables(engine)

    # Reseeded, not left empty.
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM safety_rules")).scalar() == 9
        assert conn.execute(text("SELECT COUNT(*) FROM claims_registry")).scalar() == 12
