"""Where a reference document's text came from: an uploaded file or a web page

Revision ID: 0002_document_origins
Revises: 0001_reference_corpus
Create Date: 2026-10-18

Owner decision 2026-10-18 (Addendum B §B6 item 3): a corpus document can take
its text from an uploaded PDF or Word file, or from one web page, as well as
from typed text. One row per document at most -- a document has one origin, and
replacing the file or fetching the page again overwrites it while the document
is still a draft.

The file itself lives in the corpus module's private Cloud Storage bucket; this
row holds where (`object_name`), what it was called, its type, size and SHA-256,
so the console can show and download the original. A web page keeps only its
URL and when it was fetched: the page is public and can be opened again.

Reversible per §17: `downgrade` drops exactly this table. The stored files are
not touched by a downgrade, and nothing else in `somnus_content` references it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_document_origins"
down_revision: str | Sequence[str] | None = "0001_reference_corpus"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "reference_document_origins",
        sa.Column("document_id", sa.String(length=36), nullable=False),
        # file | web_page.
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("object_name", sa.String(length=255), nullable=True),
        sa.Column("filename", sa.String(length=255), nullable=True),
        sa.Column("content_type", sa.String(length=128), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("source_url", sa.String(length=2048), nullable=True),
        sa.Column("added_by", sa.String(length=36), nullable=False),
        sa.Column("added_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["reference_documents.id"]),
        sa.PrimaryKeyConstraint("document_id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("reference_document_origins")
