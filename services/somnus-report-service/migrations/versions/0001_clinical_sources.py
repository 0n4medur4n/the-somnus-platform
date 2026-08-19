"""Checkpoint 11.3 clinical-source corpus for grounding

Revision ID: 0001_clinical_sources
Revises:
Create Date: 2026-08-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision: str = "0001_clinical_sources"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "clinical_sources",
        sa.Column("content_version", sa.String(length=32), nullable=False),
        sa.Column("source_id", sa.String(length=16), nullable=False),
        sa.Column("citation", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("use_text", sa.Text(), nullable=False),
        sa.Column("embedding", mysql.LONGTEXT(), nullable=True),
        sa.Column("embedding_model", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("content_version", "source_id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("clinical_sources")
