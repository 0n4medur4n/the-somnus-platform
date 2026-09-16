"""The rights rule itself (Addendum B §B4 / Checkpoint 16.2).

`require_publishable` is the single definition of "righted", used by both the
publish transition and the embedding gate. Testing it directly is what keeps those
two from drifting into disagreeing about what counts — and it is where the
"evidence" half is pinned, because a status without its evidence is a claim nobody
checked.
"""

from __future__ import annotations

import pytest

from report.corpus.rights import (
    REQUIRED_EVIDENCE,
    RIGHTS_CITATION_ONLY,
    RIGHTS_LICENSED,
    RIGHTS_OPEN_ACCESS,
    RIGHTS_OWN_DOCUMENT,
    RIGHTS_STATUSES,
    RightsError,
    build_evidence,
    parse_evidence,
    require_publishable,
)

#: Each status with evidence that satisfies it. Used to prove each one ALONE is
#: sufficient, which is what §B4 promises.
SUFFICIENT = {
    RIGHTS_OWN_DOCUMENT: None,
    RIGHTS_OPEN_ACCESS: build_evidence(licence="CC-BY-4.0", url="https://example.org/guide"),
    RIGHTS_LICENSED: build_evidence(licence="Elsevier institutional", holder="Hospital X"),
    RIGHTS_CITATION_ONLY: None,
}


def test_the_four_statuses_are_exactly_what_b4_names() -> None:
    assert {"own_document", "open_access", "licensed", "citation_only"} == RIGHTS_STATUSES
    assert set(REQUIRED_EVIDENCE) == RIGHTS_STATUSES


@pytest.mark.parametrize("status", sorted(RIGHTS_STATUSES))
def test_each_status_alone_is_sufficient_once_its_evidence_is_present(status: str) -> None:
    require_publishable(status, SUFFICIENT[status])


# --- the refusals -------------------------------------------------------------


@pytest.mark.parametrize("unset", [None, "", "   "])
def test_an_unset_status_is_refused(unset: str | None) -> None:
    with pytest.raises(RightsError, match="rights_status is not set"):
        require_publishable(unset, None)


def test_a_status_nobody_defined_is_refused() -> None:
    # Not a silent pass-through: an unknown word is not a rights declaration.
    with pytest.raises(RightsError, match="unknown rights_status"):
        require_publishable("probably_fine", None)


@pytest.mark.parametrize(
    ("status", "evidence"),
    [
        (RIGHTS_OPEN_ACCESS, None),
        (RIGHTS_OPEN_ACCESS, build_evidence(licence="CC-BY-4.0")),
        (RIGHTS_OPEN_ACCESS, build_evidence(url="https://example.org/guide")),
        (RIGHTS_LICENSED, None),
        (RIGHTS_LICENSED, build_evidence(licence="Elsevier institutional")),
        (RIGHTS_LICENSED, build_evidence(holder="Hospital X")),
    ],
)
def test_a_status_missing_its_required_evidence_is_refused(
    status: str, evidence: str | None
) -> None:
    with pytest.raises(RightsError, match="requires"):
        require_publishable(status, evidence)


@pytest.mark.parametrize(
    ("status", "evidence"),
    [
        (RIGHTS_OPEN_ACCESS, '{"licence": "", "url": "https://example.org"}'),
        (RIGHTS_OPEN_ACCESS, '{"licence": "CC-BY-4.0", "url": "   "}'),
        (RIGHTS_LICENSED, '{"licence": "   ", "holder": "Hospital X"}'),
        (RIGHTS_LICENSED, '{"licence": "Elsevier", "holder": ""}'),
    ],
)
def test_a_blank_field_is_not_evidence(status: str, evidence: str) -> None:
    """§B4's point: someone filling in the form is not someone checking the rights.

    Refused in exactly the same way as a missing field, so an empty box cannot buy
    a publish that a missing box would not.
    """
    with pytest.raises(RightsError, match="missing or blank"):
        require_publishable(status, evidence)


def test_unreadable_evidence_counts_as_none() -> None:
    # Whatever this is, it is not an evidence record; it must not be read as one.
    for unusable in ("not json at all", "[]", '"a string"', "null"):
        with pytest.raises(RightsError, match="missing or blank"):
            require_publishable(RIGHTS_OPEN_ACCESS, unusable)


# --- the evidence helpers -----------------------------------------------------


def test_build_evidence_drops_blanks_rather_than_recording_them() -> None:
    assert parse_evidence(build_evidence(licence="CC-BY", url="  ", holder="")) == {
        "licence": "CC-BY"
    }


def test_build_evidence_is_stable_so_two_identical_declarations_match() -> None:
    assert build_evidence(url="https://x", licence="CC-BY") == build_evidence(
        licence="CC-BY", url="https://x"
    )


def test_parse_evidence_of_nothing_is_empty_not_an_error() -> None:
    assert parse_evidence(None) == {}
    assert parse_evidence("") == {}
