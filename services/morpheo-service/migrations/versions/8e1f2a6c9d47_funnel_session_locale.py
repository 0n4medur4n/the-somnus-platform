"""The language a v2 interview is held in (owner decision 2026-11-21)

Every interview existing before this migration was held in Spanish, so the
column defaults to "es" and they read exactly as before. Reversible: the
downgrade drops the column, and every interview then reads in Spanish.

Revision ID: 8e1f2a6c9d47
Revises: 7c4d1e9a2b6f
Create Date: 2026-11-21 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8e1f2a6c9d47"
down_revision: str | Sequence[str] | None = "7c4d1e9a2b6f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "funnel_sessions",
        sa.Column("locale", sa.String(length=8), nullable=False, server_default="es"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("funnel_sessions", "locale")
