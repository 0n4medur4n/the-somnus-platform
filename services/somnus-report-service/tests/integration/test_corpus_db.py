"""The reference corpus, against MySQL (Addendum B §B3 / Checkpoint 16.1).

Storage and versioning only: no console (16.3), no rights gate (16.2), no
embedding (16.4). What is proven here is the property the later checkpoints rest
on — the corpus is append-and-retire, so a report stamped with an older
`corpus_version` stays explainable after the corpus has moved on.
"""

from __future__ import annotations

import pytest
from sqlalchemy import Engine, inspect
from sqlalchemy.orm import Session

from report.corpus.models import (
    CorpusVersionRow,
    ReferenceDocumentChunkRow,
    ReferenceDocumentRow,
    ReferenceDocumentScopeRow,
)
from report.corpus.repository import (
    STATUS_PUBLISHED,
    STATUS_RETIRED,
    CorpusRepository,
    CorpusStateError,
    DocumentScope,
)

ADMIN = "018f0000-0000-7000-8000-0000000000aa"


@pytest.fixture
def repo(corpus_session: Session) -> CorpusRepository:
    for table in (
        ReferenceDocumentScopeRow,
        ReferenceDocumentChunkRow,
        ReferenceDocumentRow,
        CorpusVersionRow,
    ):
        corpus_session.query(table).delete()
    corpus_session.commit()
    return CorpusRepository(corpus_session)


def _draft(repo: CorpusRepository, title: str, *, locale: str = "es", scope: str = "INS") -> str:
    return repo.add_draft(
        title=title,
        citation=f"{title}. Revista, 2026.",
        source_type="guideline",
        locale=locale,
        added_by=ADMIN,
        scopes=[DocumentScope("module", scope)],
    )


def test_the_corpus_tables_exist_in_their_own_database(corpus_engine: Engine) -> None:
    tables = set(inspect(corpus_engine).get_table_names())
    assert {
        "corpus_versions",
        "reference_documents",
        "reference_document_chunks",
        "reference_document_scopes",
    } <= tables
    # And the report service's own tables are NOT here: two logical databases,
    # two histories (§3.9). If this fails, one history ran against the other's
    # database.
    assert "clinical_sources" not in tables
    assert "ai_content_review_items" not in tables


def test_a_draft_creates_no_corpus_version(repo: CorpusRepository) -> None:
    document_id = _draft(repo, "Higiene del sueño")
    assert repo.current_version() == 0
    assert repo.versions() == []
    # A draft is not live at any version, including the one that does not exist yet.
    assert repo.documents_live_at(0) == []
    assert repo.get(document_id).corpus_version_added is None


def test_publishing_bumps_the_version_and_records_a_changelog(repo: CorpusRepository) -> None:
    document_id = _draft(repo, "Higiene del sueño")
    version = repo.publish(document_id, by=ADMIN, changelog="Añadida guía de higiene del sueño")

    assert version == 1
    assert repo.current_version() == 1
    entries = repo.versions()
    assert [(entry.version, entry.created_by) for entry in entries] == [(1, ADMIN)]
    assert entries[0].changelog == "Añadida guía de higiene del sueño"

    document = repo.get(document_id)
    assert document.status == STATUS_PUBLISHED
    assert document.corpus_version_added == 1
    assert document.scopes == (DocumentScope("module", "INS"),)


def test_a_version_always_carries_a_changelog(repo: CorpusRepository) -> None:
    document_id = _draft(repo, "Sin changelog")
    with pytest.raises(CorpusStateError, match="changelog"):
        repo.publish(document_id, by=ADMIN, changelog="   ")
    assert repo.current_version() == 0


def test_retiring_preserves_the_row_and_stamps_the_version(repo: CorpusRepository) -> None:
    document_id = _draft(repo, "Guía retirada")
    added = repo.publish(document_id, by=ADMIN, changelog="Publicada")
    retired = repo.retire(
        document_id, by=ADMIN, reason="Sustituida por la edición de 2027", changelog="Retirada"
    )

    assert (added, retired) == (1, 2)
    document = repo.get(document_id)
    # The row is still there, with everything it had, plus why it went.
    assert document.status == STATUS_RETIRED
    assert document.title == "Guía retirada"
    assert document.corpus_version_added == 1
    assert document.corpus_version_retired == 2
    assert document.retired_reason == "Sustituida por la edición de 2027"
    # And retiring bumped the corpus version, with its own changelog entry.
    assert [entry.changelog for entry in repo.versions()] == ["Publicada", "Retirada"]


def test_there_is_no_way_to_delete_a_document() -> None:
    # §B3 is "append and retire, never delete". Asserted against the interface
    # itself: a caller cannot delete because no method does.
    assert not [name for name in dir(CorpusRepository) if "delete" in name or "remove" in name]


def test_an_older_corpus_version_still_resolves_what_was_live_then(
    repo: CorpusRepository,
) -> None:
    """The exit criterion: a report stamped v2 can still say what grounded it."""
    first = _draft(repo, "Guía uno")
    repo.publish(first, by=ADMIN, changelog="v1: guía uno")

    second = _draft(repo, "Guía dos")
    repo.publish(second, by=ADMIN, changelog="v2: guía dos")

    retired_at = repo.retire(first, by=ADMIN, reason="Obsoleta", changelog="v3: retira uno")
    assert retired_at == 3

    third = _draft(repo, "Guía tres")
    repo.publish(third, by=ADMIN, changelog="v4: guía tres")

    live = {version: [d.title for d in repo.documents_live_at(version)] for version in range(5)}
    assert live == {
        0: [],
        1: ["Guía uno"],
        2: ["Guía uno", "Guía dos"],
        # Retired AT 3, so no longer live at 3 — but it still was at 1 and 2,
        # which is the whole point of keeping the row.
        3: ["Guía dos"],
        4: ["Guía dos", "Guía tres"],
    }


def test_live_documents_can_be_narrowed_by_locale(repo: CorpusRepository) -> None:
    spanish = _draft(repo, "Guía es", locale="es")
    english = _draft(repo, "Guide en", locale="en")
    repo.publish(spanish, by=ADMIN, changelog="es")
    repo.publish(english, by=ADMIN, changelog="en")

    assert [d.title for d in repo.documents_live_at(2, locale="es")] == ["Guía es"]
    assert [d.title for d in repo.documents_live_at(2, locale="en")] == ["Guide en"]


def test_chunks_are_stored_in_order_and_unembedded(repo: CorpusRepository) -> None:
    document_id = _draft(repo, "Con fragmentos")
    repo.add_chunks(document_id, ["primero", "segundo", "tercero"])
    assert repo.chunk_texts(document_id) == ["primero", "segundo", "tercero"]


def test_the_state_machine_refuses_the_transitions_it_should(repo: CorpusRepository) -> None:
    document_id = _draft(repo, "Estados")
    with pytest.raises(CorpusStateError, match="not published"):
        repo.retire(document_id, by=ADMIN, reason="x", changelog="x")

    repo.publish(document_id, by=ADMIN, changelog="Publicada")
    with pytest.raises(CorpusStateError, match="not a draft"):
        repo.publish(document_id, by=ADMIN, changelog="Otra vez")
    with pytest.raises(CorpusStateError, match="only added to a draft"):
        repo.add_chunks(document_id, ["tarde"])

    repo.retire(document_id, by=ADMIN, reason="x", changelog="Retirada")
    with pytest.raises(CorpusStateError, match="not published"):
        repo.retire(document_id, by=ADMIN, reason="x", changelog="Otra vez")


def test_an_unknown_scope_type_is_refused(repo: CorpusRepository) -> None:
    with pytest.raises(CorpusStateError, match="unknown scope type"):
        repo.add_draft(
            title="Ámbito inválido",
            citation="c",
            source_type="guideline",
            locale="es",
            added_by=ADMIN,
            scopes=[DocumentScope("module_or_something", "INS")],
        )
