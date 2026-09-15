"""Every Alembic revision id fits the column Alembic stamps it into.

`alembic_version.version_num` is VARCHAR(32). A longer id is not caught by ruff,
mypy, or any test that does not touch a database: the migration's DDL runs, and
then stamping the version fails with `Data too long for column 'version_num'`,
leaving the schema changed and the version table not. That is exactly how
`0003` first shipped (as `0003_clinical_source_cited_by_rules`, 35 characters),
and it only surfaced in CI because every integration test shares the migrated
engine fixture.

Reads the files as text rather than importing them, so this runs anywhere.
"""

from __future__ import annotations

import re
from pathlib import Path

VERSIONS = Path(__file__).resolve().parents[2] / "migrations" / "versions"
ALEMBIC_VERSION_NUM_LENGTH = 32
_REVISION = re.compile(r'^revision: str = "([^"]+)"', re.MULTILINE)


def _revision_ids() -> dict[str, str]:
    found: dict[str, str] = {}
    for path in sorted(VERSIONS.glob("*.py")):
        match = _REVISION.search(path.read_text(encoding="utf-8"))
        if match:
            found[path.name] = match.group(1)
    return found


def test_there_are_migrations_to_check() -> None:
    # A pattern that silently stopped matching would make the test below pass
    # by checking nothing.
    assert len(_revision_ids()) >= 3


def test_every_revision_id_fits_alembic_version_num() -> None:
    too_long = {
        name: (revision, len(revision))
        for name, revision in _revision_ids().items()
        if len(revision) > ALEMBIC_VERSION_NUM_LENGTH
    }
    assert too_long == {}
