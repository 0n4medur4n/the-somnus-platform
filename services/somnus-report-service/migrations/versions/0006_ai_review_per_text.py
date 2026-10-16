"""AI wording reviewed once per sentence, not once per report

Revision ID: 0006_ai_review_per_text
Revises: 0005_report_corpus_provenance
Create Date: 2026-10-16

The AI rewords the report's fixed approved sentences (a pattern's summary, a care
level's action), which are the same in every report that prints them. So an item
in the review queue can now belong to a SENTENCE instead of one report:

* `report_id` becomes nullable -- a per-text item belongs to no single report;
* `text_ref` (new, nullable) says which sentence it rewords, e.g. "module:INS";
* `ix_ai_content_review_input_status` serves the lookup every AI-on render makes,
  once per sentence: the approved item for this input hash.

Existing per-report items are untouched. Reversible per §17: `downgrade` removes
the per-text items (they have no report to belong to under the old schema), then
drops the index and the column and makes `report_id` NOT NULL again.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006_ai_review_per_text"
down_revision: str | Sequence[str] | None = "0005_report_corpus_provenance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        "ai_content_review_items",
        "report_id",
        existing_type=sa.String(length=32),
        nullable=True,
    )
    op.add_column(
        "ai_content_review_items",
        sa.Column("text_ref", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_ai_content_review_input_status",
        "ai_content_review_items",
        ["input_hash", "status"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM ai_content_review_items WHERE report_id IS NULL")
    op.drop_index("ix_ai_content_review_input_status", table_name="ai_content_review_items")
    op.drop_column("ai_content_review_items", "text_ref")
    op.alter_column(
        "ai_content_review_items",
        "report_id",
        existing_type=sa.String(length=32),
        nullable=False,
    )
