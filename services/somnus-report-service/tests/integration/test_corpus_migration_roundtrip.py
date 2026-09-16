"""The corpus migration is reversible (build plan §8 / §19: up AND down).

Its own history, against its own database. Down then up, so a failed deploy can be
backed out and re-applied without hand-editing `alembic_version`.
"""

from __future__ import annotations

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, inspect

CORPUS_TABLES = {
    "corpus_versions",
    "reference_documents",
    "reference_document_chunks",
    "reference_document_scopes",
}


def _tables(engine: Engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def test_downgrade_then_upgrade_restores_the_corpus_schema(corpus_engine: Engine) -> None:
    config = Config("alembic_content.ini")

    command.downgrade(config, "base")
    assert CORPUS_TABLES & _tables(corpus_engine) == set()

    command.upgrade(config, "head")
    assert _tables(corpus_engine) >= CORPUS_TABLES

    columns = {c["name"] for c in inspect(corpus_engine).get_columns("reference_documents")}
    assert {
        "id",
        "title",
        "citation",
        "source_type",
        "locale",
        "status",
        "rights_status",
        "rights_evidence",
        "added_by",
        "added_at",
        "reviewed_by",
        "reviewed_at",
        "retired_at",
        "retired_reason",
        "corpus_version_added",
        "corpus_version_retired",
    } <= columns
