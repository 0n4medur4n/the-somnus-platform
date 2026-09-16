"""Checkpoint 16.5: what grounded each generated report

Revision ID: 0005_report_corpus_provenance
Revises: 0004_source_text_hash
Create Date: 2026-09-16

Addendum B §B5 Checkpoint 16.5: "Every generated report records which
`corpus_version` grounded it and which documents were retrieved."

One row per report, keyed by `report_id`, which is what makes the record
immutable at the schema level rather than only in the repository: a second write
for the same report collides with the primary key. There is no update path in
the code and no column here that a later process is expected to fill in. A
provenance record that could be edited after the fact would answer a different
question from the one it exists to answer.

`document_ids` stores WHICH Index B documents were rendered into the report's
supporting-material block — not which existed. Titles are deliberately not
stored: they are resolved at display time against `documents_live_at(corpus_version)`
in `somnus_content` (Checkpoint 16.1), so a document retired since generation is
still described as it was when the report was made. Copying the titles here would
make that resolution unnecessary and, with it, silently untested.

`citations` stores Index A's answer as rendered. That one IS stamped: it is the
citation the report carries, decided by the rule that fired, and §B3.1 makes it
the field that must never depend on anything resolved later.

This table lives in `somnus_reporting` and references `somnus_content` only by
value (§7 / §3.9: no cross-database foreign keys, each logical database its own
migration history).

Reversible per §17: `downgrade` drops exactly the table `upgrade` created.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005_report_corpus_provenance"
down_revision: str | Sequence[str] | None = "0004_source_text_hash"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "report_corpus_provenance",
        sa.Column("report_id", sa.String(32), primary_key=True),
        # The corpus version live when the report was generated. 0 is a real
        # answer: it means nothing had been published yet, which is every
        # environment today.
        sa.Column("corpus_version", sa.Integer(), nullable=False),
        sa.Column("content_version", sa.String(32), nullable=False),
        sa.Column("locale", sa.String(5), nullable=False),
        # JSON array of the Index A citations the report rendered.
        sa.Column("citations", sa.Text(), nullable=False),
        # JSON array of the Index B document ids the report rendered.
        sa.Column("document_ids", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("report_corpus_provenance")
