"""Checkpoint 15.3 AI content review queue

Revision ID: 0002_ai_content_review_items
Revises: 0001_clinical_sources
Create Date: 2026-09-07

Build plan §15: AI-generated health text requires human review before release.
Checkpoint 11.2 produced `pending_review` candidates with nothing able to consume
them; this table is that consumer's storage.

Reversible per §17: `downgrade` drops the table it created and nothing else. The
table is additive -- no existing column or row is touched -- so downgrading
returns `somnus_reporting` to exactly its 0001 shape.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_ai_content_review_items"
down_revision: str | Sequence[str] | None = "0001_clinical_sources"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "ai_content_review_items",
        sa.Column("item_id", sa.String(length=32), nullable=False),
        sa.Column("report_id", sa.String(length=32), nullable=False),
        sa.Column("prompt_template_version", sa.String(length=32), nullable=False),
        sa.Column("model_id", sa.String(length=64), nullable=False),
        sa.Column("input_hash", sa.String(length=64), nullable=False),
        sa.Column("output_hash", sa.String(length=64), nullable=False),
        sa.Column("deterministic_text", sa.Text(), nullable=False),
        sa.Column("candidate_text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("reviewer_id", sa.String(length=64), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("item_id"),
    )
    op.create_index(
        "ix_ai_content_review_status_created",
        "ai_content_review_items",
        ["status", "created_at"],
    )
    op.create_index(
        "ix_ai_content_review_report_status",
        "ai_content_review_items",
        ["report_id", "status"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_ai_content_review_report_status", table_name="ai_content_review_items")
    op.drop_index("ix_ai_content_review_status_created", table_name="ai_content_review_items")
    op.drop_table("ai_content_review_items")
