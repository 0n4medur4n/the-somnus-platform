"""The person's AI-written report, once per assessment and language

Revision ID: 0007_person_reports
Revises: 0006_ai_review_per_text
Create Date: 2026-10-17

Owner decision 2026-10-16 (build plan §15 amended): each assessment gets a report
written for the person by the AI, shown without review. Stored once so the screen
and the PDF show the same text and the model is called once.

Reversible per §17: `downgrade` drops exactly the table `upgrade` created.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007_person_reports"
down_revision: str | Sequence[str] | None = "0006_ai_review_per_text"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "person_reports",
        sa.Column("assessment_id", sa.String(64), nullable=False),
        sa.Column("locale", sa.String(5), nullable=False),
        sa.Column("content_version", sa.String(32), nullable=False),
        sa.Column("model_id", sa.String(64), nullable=False),
        sa.Column("prompt_version", sa.String(32), nullable=False),
        sa.Column("input_hash", sa.String(64), nullable=False),
        sa.Column("narrative", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("assessment_id", "locale"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("person_reports")
