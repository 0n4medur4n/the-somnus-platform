"""Which language a person's report was translated from

Revision ID: 0008_person_report_translated
Revises: 0007_person_reports
Create Date: 2026-10-17

Owner decision 2026-10-17: in another language a person sees the SAME report,
translated, not a second one written from scratch. NULL marks the original; a
translation records its source language, so the original is unambiguous even
when two rows share a second.

Reversible per §17: `downgrade` drops exactly the column `upgrade` added.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008_person_report_translated"
down_revision: str | Sequence[str] | None = "0007_person_reports"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("person_reports", sa.Column("translated_from", sa.String(5), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("person_reports", "translated_from")
