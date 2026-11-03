"""The case record of each v2 interview (ADR 0024)

Revision ID: 7c4d1e9a2b6f
Revises: 5b2e9c41a7d3
Create Date: 2026-11-03 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7c4d1e9a2b6f"
down_revision: str | Sequence[str] | None = "5b2e9c41a7d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "funnel_cases",
        sa.Column("code", sa.String(length=16), nullable=False),
        # No foreign key: the case outlives the interview (ADR 0024).
        sa.Column("session_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("content_version", sa.String(length=32), nullable=False),
        sa.Column("rules_version", sa.String(length=32), nullable=False),
        sa.Column("main_action", sa.String(length=64), nullable=True),
        sa.Column("stopped_by", sa.String(length=64), nullable=True),
        sa.Column("categories_json", sa.Text(), nullable=False),
        sa.Column("templates_json", sa.Text(), nullable=False),
        sa.Column("alerts_json", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("code"),
        sa.UniqueConstraint("session_id"),
    )
    op.create_index("ix_funnel_cases_started_at", "funnel_cases", ["started_at"])
    op.create_table(
        "funnel_case_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("case_code", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("record_json", sa.Text(), nullable=False),
        sa.Column("reconstructed", sa.Boolean(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_funnel_case_records_case_code", "funnel_case_records", ["case_code"])
    op.create_table(
        "funnel_case_changes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("case_code", sa.String(length=16), nullable=False),
        sa.Column("withdrawn_json", sa.Text(), nullable=False),
        sa.Column("changed_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_funnel_case_changes_case_code", "funnel_case_changes", ["case_code"])
    op.create_table(
        "funnel_case_accesses",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("case_code", sa.String(length=16), nullable=False),
        sa.Column("actor_id", sa.String(length=36), nullable=False),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("justification", sa.Text(), nullable=False),
        sa.Column("accessed_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_funnel_case_accesses_case_code", "funnel_case_accesses", ["case_code"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("funnel_case_accesses")
    op.drop_table("funnel_case_changes")
    op.drop_table("funnel_case_records")
    op.drop_table("funnel_cases")
