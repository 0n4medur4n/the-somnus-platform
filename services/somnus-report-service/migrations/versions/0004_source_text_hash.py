"""Checkpoint 16.0: the hash of the text each clinical-source vector came from

Revision ID: 0004_source_text_hash
Revises: 0003_source_cited_by_rules
Create Date: 2026-09-15

Addendum B §B2a.1 makes `SourceIndexer` re-runnable, keyed on
`(content_version, src_id, text_hash)`: re-running for an unchanged version makes
no embedding call, and a version bump re-embeds only the sources whose `citation`
or `use` actually changed. That needs to know which text a stored vector was
produced from, which the table did not record.

The hash is of exactly what `embedding_text()` sends to the embedding API, stored
rather than recomputed from `citation` and `use_text`: it records what was
embedded, so a row whose text was edited after the fact cannot pass for a row
whose vector still matches it.

Not backfilled. A vector written before this column carries NULL: provenance
unknown. The indexer never reuses it, never overwrites it, and refuses to re-index
that version at all, asking for a `content_version` bump instead -- the same answer
it gives when a version's text changed. In practice there should be no such rows:
until Checkpoint 16.0 the indexer had no entry point, so it cannot have been run by
any documented route. A version with no rows at all is simply indexed.

Reversible per §17: `downgrade` drops the column it added and nothing else.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004_source_text_hash"
down_revision: str | Sequence[str] | None = "0003_source_cited_by_rules"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "clinical_sources",
        sa.Column("text_hash", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("clinical_sources", "text_hash")
