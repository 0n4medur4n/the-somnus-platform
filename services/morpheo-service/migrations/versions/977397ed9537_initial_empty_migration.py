"""initial empty migration

Revision ID: 977397ed9537
Revises:
Create Date: 2026-07-21 20:04:16.345444

Intentionally empty: this checkpoint (build plan §20 Checkpoint 4.1)
only proves the Alembic + SQLAlchemy + PyMySQL wiring against
`somnus_morpheo` works end-to-end. No assessment tables exist yet
(build plan §14 lands in Phase 10.2). Both directions are no-ops, so
this revision is trivially reversible (build plan §8 migration
rollback policy).
"""

from __future__ import annotations

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "977397ed9537"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""


def downgrade() -> None:
    """Downgrade schema."""
