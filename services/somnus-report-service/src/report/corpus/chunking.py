"""Chunking, with the per-status cap §B4 requires (Checkpoint 16.2).

`citation_only` asserts that the platform holds the citation and an
abstract-length summary and *never the full text*. A cap that only lived in a
README would let someone make that claim and then paste in a whole article, which
is the exact thing the status exists to prevent — so the limit is enforced here,
where the text is turned into chunks, before anything is stored.

**Over the cap is refused, never truncated.** Silently cutting an article down to
2500 characters would leave a document whose stored text looks like a compliant
summary and whose provenance says it is one, with no record that the rest was ever
submitted. A refusal is recoverable — someone writes a real summary, or changes
the status to one that permits the full text and evidences it. A truncation is a
false claim that nobody can see.

Chunk size itself is not a rights question: it is about what makes a useful
retrieval unit later, so it applies to every status equally and splits on
paragraph boundaries where it can.
"""

from __future__ import annotations

import re
from typing import Final

from report.corpus.rights import RIGHTS_CITATION_ONLY, RightsError

#: §B4's "abstract-length summary", made a number. Roughly a long structured
#: abstract; comfortably more than any real one, and far less than an article.
CITATION_ONLY_MAX_CHARACTERS: Final = 2_500

#: The retrieval unit. Not a rights limit — the same for every status.
CHUNK_MAX_CHARACTERS: Final = 1_200

_PARAGRAPH = re.compile(r"\n\s*\n")


class ChunkTooLongError(RightsError):
    """A `citation_only` document carries more text than that status permits.

    A subclass of `RightsError` because that is what it is: the text contradicts
    the rights claim made about it. A caller catching rights failures catches this
    one too, rather than having to know it exists.
    """


def cap_for(rights_status: str | None) -> int | None:
    """The document-length cap for a status, or None where there is none."""
    return CITATION_ONLY_MAX_CHARACTERS if rights_status == RIGHTS_CITATION_ONLY else None


def chunk_text(text: str, *, rights_status: str | None) -> list[str]:
    """Split approved text into storable chunks, enforcing the per-status cap.

    Raises `ChunkTooLongError` when a `citation_only` document exceeds its cap.
    Nothing is returned in that case: the caller has no truncated text to store
    by accident.
    """
    cleaned = text.strip()
    cap = cap_for(rights_status)
    if cap is not None and len(cleaned) > cap:
        raise ChunkTooLongError(
            f"a {RIGHTS_CITATION_ONLY} document may hold at most {cap} characters "
            f"(this one has {len(cleaned)}); it is refused rather than truncated, because "
            "a shortened copy would still claim to be a summary. Write a summary, or "
            "declare the rights that permit the full text."
        )
    if not cleaned:
        return []

    chunks: list[str] = []
    for paragraph in (part.strip() for part in _PARAGRAPH.split(cleaned)):
        if not paragraph:
            continue
        if len(paragraph) <= CHUNK_MAX_CHARACTERS:
            chunks.append(paragraph)
            continue
        # A paragraph longer than one chunk is cut on whitespace where possible,
        # so a chunk does not end mid-word.
        chunks.extend(_split_long(paragraph))
    return chunks


def _split_long(paragraph: str) -> list[str]:
    pieces: list[str] = []
    remaining = paragraph
    while len(remaining) > CHUNK_MAX_CHARACTERS:
        window = remaining[:CHUNK_MAX_CHARACTERS]
        cut = window.rfind(" ")
        if cut <= 0:
            cut = CHUNK_MAX_CHARACTERS
        pieces.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    if remaining:
        pieces.append(remaining)
    return pieces
