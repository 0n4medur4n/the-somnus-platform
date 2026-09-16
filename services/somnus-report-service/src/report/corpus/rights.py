"""The rights gate (Addendum B §B4), blocking rather than advisory.

§B4's reason for existing is not data tidiness. The failure it prevents is
quietly uploading a paywalled article's full text to a third-party embedding API,
which is a legal problem rather than a bug, so the rule is enforced in code and in
two independent places: nothing publishes without a rights declaration
(`CorpusRepository.publish`) and nothing embeds without one
(`corpus.embedding_gate`). Either check alone would be enough on a good day; the
point is that neither has to be.

## The four statuses, and what counts as evidence

| status          | what it means                                | evidence required |
| --------------- | -------------------------------------------- | ----------------- |
| `own_document`  | authored by The Somnus                       | none              |
| `open_access`   | publicly licensed                            | `licence` + `url` |
| `licensed`      | institutional subscription or purchase       | `licence` + `holder` |
| `citation_only` | citation and an abstract-length summary only | none              |

`citation_only` requires no evidence because it is itself the most restrictive
claim: it asserts the platform holds no full text at all. What it costs instead is
a hard character cap enforced when the text is stored (`corpus.chunking`), so the
claim cannot be made and then quietly contradicted by a full article.

Evidence is stored as a JSON object in `reference_documents.rights_evidence`. An
empty string is not evidence: a licence field containing `""` records that someone
filled in the form, not that anyone checked, so it is refused exactly as a missing
field is.
"""

from __future__ import annotations

import json
from typing import Final

RIGHTS_OWN_DOCUMENT: Final = "own_document"
RIGHTS_OPEN_ACCESS: Final = "open_access"
RIGHTS_LICENSED: Final = "licensed"
RIGHTS_CITATION_ONLY: Final = "citation_only"

RIGHTS_STATUSES: Final[frozenset[str]] = frozenset(
    {RIGHTS_OWN_DOCUMENT, RIGHTS_OPEN_ACCESS, RIGHTS_LICENSED, RIGHTS_CITATION_ONLY}
)

#: The fields each status must be able to show, beyond the status itself.
REQUIRED_EVIDENCE: Final[dict[str, tuple[str, ...]]] = {
    RIGHTS_OWN_DOCUMENT: (),
    RIGHTS_OPEN_ACCESS: ("licence", "url"),
    RIGHTS_LICENSED: ("licence", "holder"),
    RIGHTS_CITATION_ONLY: (),
}

#: Statuses §B4 asks the console to warn about in plain language (Checkpoint 16.3).
WARN_ON_PUBLISH: Final[frozenset[str]] = frozenset({RIGHTS_LICENSED, RIGHTS_CITATION_ONLY})


class RightsError(RuntimeError):
    """A document's rights are unset, unknown, or unevidenced (§B4)."""


def parse_evidence(raw: str | None) -> dict[str, str]:
    """The stored evidence as a mapping, or `{}` when there is none.

    Anything unparseable, or parseable but not an object, is treated as no
    evidence at all rather than raising here: `require_publishable` is the single
    place that decides whether what we have is enough, and it refuses either way.
    """
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(key): str(value) for key, value in parsed.items()}


def build_evidence(**fields: str) -> str:
    """Serialize evidence for storage. Blank values are dropped, not recorded."""
    return json.dumps(
        {key: value.strip() for key, value in fields.items() if value and value.strip()},
        sort_keys=True,
        ensure_ascii=False,
    )


def require_publishable(rights_status: str | None, rights_evidence: str | None) -> None:
    """Raise unless this document's rights are declared AND evidenced (§B4).

    The single definition of "righted", used by both the publish transition and
    the embedding gate, so the two cannot drift into disagreeing about what
    counts.
    """
    if rights_status is None or not rights_status.strip():
        raise RightsError(
            "rights_status is not set; §B4 requires a rights declaration before a "
            "reference document is published or embedded"
        )
    status = rights_status.strip()
    if status not in RIGHTS_STATUSES:
        raise RightsError(
            f"unknown rights_status {status!r}; expected one of {sorted(RIGHTS_STATUSES)}"
        )

    evidence = parse_evidence(rights_evidence)
    missing = [
        field
        for field in REQUIRED_EVIDENCE[status]
        # Present-but-blank is missing: someone filled in the form, nobody checked.
        if not evidence.get(field, "").strip()
    ]
    if missing:
        raise RightsError(
            f"rights_status {status!r} requires {', '.join(REQUIRED_EVIDENCE[status])}; "
            f"missing or blank: {', '.join(missing)}"
        )
