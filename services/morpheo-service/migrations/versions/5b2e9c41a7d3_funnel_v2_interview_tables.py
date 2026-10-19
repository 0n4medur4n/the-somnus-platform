"""The v2 interview tables (embudo v0.2, ADR 0020)

Revision ID: 5b2e9c41a7d3
Revises: 00bcc35f40bb
Create Date: 2026-10-19 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5b2e9c41a7d3"
down_revision: str | Sequence[str] | None = "00bcc35f40bb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "funnel_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("owner_id", sa.String(length=36), nullable=True),
        sa.Column("consent_given", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("content_version", sa.String(length=32), nullable=False),
        sa.Column("rules_version", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_funnel_sessions_owner_id", "funnel_sessions", ["owner_id"])
    op.create_table(
        "funnel_answers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("step_key", sa.String(length=64), nullable=False),
        sa.Column("value_json", sa.Text(), nullable=True),
        sa.Column("absence", sa.String(length=32), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["funnel_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_funnel_answers_session_id", "funnel_answers", ["session_id"])


def downgrade() -> None:
    """Downgrade schema."""
    # MySQL refuses to drop ix_funnel_answers_session_id while the foreign key
    # to funnel_sessions needs it (1553); dropping the table takes its indexes
    # and its foreign key with it, in the right order.
    op.drop_table("funnel_answers")
    op.drop_table("funnel_sessions")
