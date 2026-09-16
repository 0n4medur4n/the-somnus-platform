"""The rights gate on the publish transition, against MySQL (§B4 / 16.2).

The unit suites pin the rule; this pins that the repository actually applies it,
and that a refusal leaves the database exactly as it was — no half-published
document, and no orphan `corpus_version` recording a publish that never happened.
"""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from report.corpus.chunking import CITATION_ONLY_MAX_CHARACTERS, ChunkTooLongError
from report.corpus.models import (
    CorpusVersionRow,
    ReferenceDocumentChunkRow,
    ReferenceDocumentRow,
    ReferenceDocumentScopeRow,
)
from report.corpus.repository import (
    STATUS_DRAFT,
    CorpusRepository,
    DocumentScope,
)
from report.corpus.rights import (
    RIGHTS_CITATION_ONLY,
    RIGHTS_LICENSED,
    RIGHTS_OPEN_ACCESS,
    RIGHTS_OWN_DOCUMENT,
    RightsError,
    build_evidence,
)

ADMIN = "018f0000-0000-7000-8000-0000000000aa"

SUFFICIENT: list[tuple[str, str | None]] = [
    (RIGHTS_OWN_DOCUMENT, None),
    (RIGHTS_CITATION_ONLY, None),
    (RIGHTS_OPEN_ACCESS, build_evidence(licence="CC-BY-4.0", url="https://example.org/guia")),
    (RIGHTS_LICENSED, build_evidence(licence="Elsevier institutional", holder="Hospital X")),
]

UNEVIDENCED: list[tuple[str, str | None]] = [
    (RIGHTS_OPEN_ACCESS, None),
    (RIGHTS_OPEN_ACCESS, build_evidence(licence="CC-BY-4.0")),
    (RIGHTS_OPEN_ACCESS, '{"licence": "CC-BY-4.0", "url": ""}'),
    (RIGHTS_LICENSED, None),
    (RIGHTS_LICENSED, build_evidence(holder="Hospital X")),
    (RIGHTS_LICENSED, '{"licence": "  ", "holder": "Hospital X"}'),
]


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


def _draft(
    repo: CorpusRepository, *, rights_status: str | None = None, rights_evidence: str | None = None
) -> str:
    return repo.add_draft(
        title="Guía de higiene del sueño",
        citation="Autoría. Revista, 2026.",
        source_type="guideline",
        locale="es",
        added_by=ADMIN,
        scopes=[DocumentScope("module", "INS")],
        rights_status=rights_status,
        rights_evidence=rights_evidence,
    )


def test_publish_is_refused_when_rights_status_is_unset(repo: CorpusRepository) -> None:
    document_id = _draft(repo)

    with pytest.raises(RightsError, match="rights_status is not set"):
        repo.publish(document_id, by=ADMIN, changelog="Intento de publicación")

    document = repo.get(document_id)
    assert document.status == STATUS_DRAFT
    assert document.corpus_version_added is None
    # And no version was created for the publish that did not happen: the gate
    # runs before the bump, so there is no orphan entry in the changelog.
    assert repo.current_version() == 0
    assert repo.versions() == []


@pytest.mark.parametrize(("status", "evidence"), SUFFICIENT, ids=[s for s, _ in SUFFICIENT])
def test_each_status_alone_publishes_once_its_evidence_is_present(
    repo: CorpusRepository, status: str, evidence: str | None
) -> None:
    document_id = _draft(repo, rights_status=status, rights_evidence=evidence)

    version = repo.publish(document_id, by=ADMIN, changelog=f"Publicada como {status}")

    assert version == 1
    assert repo.get(document_id).rights_status == status


@pytest.mark.parametrize(
    ("status", "evidence"), UNEVIDENCED, ids=[f"{s}-{i}" for i, (s, _) in enumerate(UNEVIDENCED)]
)
def test_a_status_without_its_evidence_is_refused_exactly_like_a_missing_status(
    repo: CorpusRepository, status: str, evidence: str | None
) -> None:
    """§B4: an empty-string licence or URL is not evidence.

    Same exception type, same outcome, same untouched database as leaving
    `rights_status` null entirely — so a half-filled form buys nothing.
    """
    document_id = _draft(repo, rights_status=status, rights_evidence=evidence)

    with pytest.raises(RightsError):
        repo.publish(document_id, by=ADMIN, changelog="Intento")

    assert repo.get(document_id).status == STATUS_DRAFT
    assert repo.versions() == []


def test_an_unknown_status_is_refused(repo: CorpusRepository) -> None:
    document_id = _draft(repo, rights_status="probably_fine")
    with pytest.raises(RightsError, match="unknown rights_status"):
        repo.publish(document_id, by=ADMIN, changelog="Intento")
    assert repo.get(document_id).status == STATUS_DRAFT


# --- the cap, at the moment text would be stored ------------------------------


def test_citation_only_text_over_the_cap_is_refused_and_nothing_is_stored(
    repo: CorpusRepository,
) -> None:
    document_id = _draft(repo, rights_status=RIGHTS_CITATION_ONLY)
    article = "palabra " * 2_000

    with pytest.raises(ChunkTooLongError, match="truncated"):
        repo.add_text(document_id, article)

    # Not truncated, not partially stored: nothing was written at all.
    assert repo.chunk_texts(document_id) == []


def test_a_citation_only_summary_within_the_cap_is_stored(repo: CorpusRepository) -> None:
    document_id = _draft(repo, rights_status=RIGHTS_CITATION_ONLY)
    summary = "Resumen breve del artículo, dentro del límite."

    repo.add_text(document_id, summary)

    assert repo.chunk_texts(document_id) == [summary]


def test_a_licensed_document_may_hold_more_than_the_citation_only_cap(
    repo: CorpusRepository,
) -> None:
    document_id = _draft(
        repo,
        rights_status=RIGHTS_LICENSED,
        rights_evidence=build_evidence(licence="Elsevier institutional", holder="Hospital X"),
    )

    repo.add_text(document_id, "palabra " * 2_000)

    stored = repo.chunk_texts(document_id)
    assert sum(len(chunk) for chunk in stored) > CITATION_ONLY_MAX_CHARACTERS
