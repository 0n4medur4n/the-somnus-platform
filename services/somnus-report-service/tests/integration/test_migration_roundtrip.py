"""The clinical-sources migration is reversible (build plan §8 / §19: up AND down)."""

from __future__ import annotations

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, inspect


def _tables(engine: Engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def test_downgrade_then_upgrade_restores_the_schema(engine: Engine) -> None:
    config = Config("alembic.ini")

    command.downgrade(config, "base")
    assert "clinical_sources" not in _tables(engine)

    command.upgrade(config, "head")
    assert "clinical_sources" in _tables(engine)
    columns = {column["name"] for column in inspect(engine).get_columns("clinical_sources")}
    assert {
        "content_version",
        "source_id",
        "citation",
        "url",
        "use_text",
        "embedding",
        "embedding_model",
        "created_at",
    } <= columns
