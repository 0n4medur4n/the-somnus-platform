"""The per-status cap at chunk time (Addendum B §B4 / Checkpoint 16.2).

The assertion that matters is not "long text raises". It is that the refusal
leaves NOTHING usable behind — no truncated list a caller could store and then
present as a compliant summary. So the tests check what comes back, not only that
something was raised.
"""

from __future__ import annotations

import pytest

from report.corpus.chunking import (
    CHUNK_MAX_CHARACTERS,
    CITATION_ONLY_MAX_CHARACTERS,
    ChunkTooLongError,
    cap_for,
    chunk_text,
)
from report.corpus.rights import (
    RIGHTS_CITATION_ONLY,
    RIGHTS_LICENSED,
    RIGHTS_OPEN_ACCESS,
    RIGHTS_OWN_DOCUMENT,
    RightsError,
)

ABSTRACT = "Un resumen corto del artículo."
FULL_ARTICLE = "palabra " * 2_000  # ~16k characters: an article, not an abstract


def test_only_citation_only_carries_a_document_cap() -> None:
    assert cap_for(RIGHTS_CITATION_ONLY) == CITATION_ONLY_MAX_CHARACTERS
    for status in (RIGHTS_OWN_DOCUMENT, RIGHTS_OPEN_ACCESS, RIGHTS_LICENSED, None):
        assert cap_for(status) is None


def test_a_citation_only_summary_within_the_cap_is_stored() -> None:
    assert chunk_text(ABSTRACT, rights_status=RIGHTS_CITATION_ONLY) == [ABSTRACT]


def test_citation_only_text_over_the_cap_is_refused_not_truncated() -> None:
    with pytest.raises(ChunkTooLongError) as error:
        chunk_text(FULL_ARTICLE, rights_status=RIGHTS_CITATION_ONLY)

    # The refusal says what it is and what to do, and names no article text.
    message = str(error.value)
    assert str(CITATION_ONLY_MAX_CHARACTERS) in message
    assert "truncated" in message
    assert "palabra" not in message


def test_nothing_survives_the_refusal_to_be_stored_by_accident() -> None:
    """The truncation failure mode, ruled out directly.

    A chunker that capped by slicing would return a list here — shorter, plausible,
    and a false claim that the platform holds only a summary. There is no return
    value at all on this path.
    """
    stored: list[str] | None = None
    with pytest.raises(ChunkTooLongError):
        stored = chunk_text(FULL_ARTICLE, rights_status=RIGHTS_CITATION_ONLY)
    assert stored is None


def test_exactly_at_the_cap_is_allowed_and_one_over_is_not() -> None:
    at_cap = "a" * CITATION_ONLY_MAX_CHARACTERS
    assert chunk_text(at_cap, rights_status=RIGHTS_CITATION_ONLY)

    with pytest.raises(ChunkTooLongError):
        chunk_text("a" * (CITATION_ONLY_MAX_CHARACTERS + 1), rights_status=RIGHTS_CITATION_ONLY)


def test_the_cap_is_a_rights_error_so_callers_catching_rights_failures_catch_it() -> None:
    with pytest.raises(RightsError):
        chunk_text(FULL_ARTICLE, rights_status=RIGHTS_CITATION_ONLY)


@pytest.mark.parametrize("status", [RIGHTS_OWN_DOCUMENT, RIGHTS_OPEN_ACCESS, RIGHTS_LICENSED])
def test_a_status_that_permits_full_text_is_not_capped(status: str) -> None:
    chunks = chunk_text(FULL_ARTICLE, rights_status=status)
    assert sum(len(chunk) for chunk in chunks) > CITATION_ONLY_MAX_CHARACTERS


# --- chunking itself ----------------------------------------------------------


def test_paragraphs_become_chunks() -> None:
    assert chunk_text("uno\n\ndos\n\ntres", rights_status=RIGHTS_OWN_DOCUMENT) == [
        "uno",
        "dos",
        "tres",
    ]


def test_empty_text_is_no_chunks_rather_than_one_empty_chunk() -> None:
    assert chunk_text("   \n\n  ", rights_status=RIGHTS_OWN_DOCUMENT) == []


def test_a_long_paragraph_is_split_without_cutting_a_word_in_half() -> None:
    paragraph = "palabra " * 400  # one paragraph, longer than a chunk
    chunks = chunk_text(paragraph, rights_status=RIGHTS_OWN_DOCUMENT)

    assert len(chunks) > 1
    assert all(len(chunk) <= CHUNK_MAX_CHARACTERS for chunk in chunks)
    # Nothing was lost and no word was broken across the split.
    assert "".join(chunks).replace(" ", "") == paragraph.replace(" ", "")
    assert all(chunk.split()[0] == "palabra" for chunk in chunks)
