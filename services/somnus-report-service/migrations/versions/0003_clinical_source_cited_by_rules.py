"""Checkpoint 11.3 Stage 4: which safety rules cite each clinical source

Revision ID: 0003_clinical_source_cited_by_rules
Revises: 0002_ai_content_review_items
Create Date: 2026-09-11

Build plan §14b promises a professional report retrieves "the approved clinical
source that the deterministic rule already cited". Until this column existed
nothing implemented that: the report embedded the routed module's NAME and took
the cosine top-1 over the whole corpus, which can pick a source the fired rule
never cited. The mapping now travels from the clinical artifact
(`safety_rules[].sources`) through morpheo's clinical-sources response and is
stored here, keyed by `content_version` like the citation text it selects -- so a
report rendered against an older version resolves that version's mapping.

Reversible per §17: `downgrade` drops the column it added and nothing else. The
column is additive and nullable -- no existing column or row is touched, and
rows written before it exists read back as "cited by no rule", which is the
pre-migration behaviour exactly.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_clinical_source_cited_by_rules"
down_revision: str | Sequence[str] | None = "0002_ai_content_review_items"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "clinical_sources",
        sa.Column("cited_by_rules", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("clinical_sources", "cited_by_rules")
