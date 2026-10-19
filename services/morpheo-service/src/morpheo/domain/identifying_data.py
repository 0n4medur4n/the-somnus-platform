"""The identifying-data filter for health free text (owner decision 2026-10-17).

The Python twin of `packages/api-contracts/src/morpheo/identifying-data.ts`:
the edge refuses such a note through the Zod contract, and morpheo refuses it
again here before anything is stored. Both run the shared cases in
`schemas/fixtures/identifying-data.json`, so the two cannot drift apart.

It catches the obvious -- an email address, a phone number, a Spanish DNI/NIE.
Names and dates of birth cannot be told apart from ordinary words and dates, so
the screen also asks the person not to write them.
"""

from __future__ import annotations

import re
from typing import Literal

IdentifyingDataKind = Literal["email", "phone", "national_id"]

# The longest free-text answer or note accepted (v2: Q01 narrative included).
FREE_TEXT_MAX_LENGTH = 2000

# The DNI/NIE control letter is any letter but I, Ñ, O and U.
_CONTROL_LETTER = "[A-HJ-NP-TV-Za-hj-np-tv-z]"

_PATTERNS: dict[IdentifyingDataKind, tuple[re.Pattern[str], ...]] = {
    "email": (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"),),
    "phone": (
        # A Spanish number: nine digits starting 6-9, optional +34 / 0034.
        re.compile(r"(?<![0-9])(?:(?:\+|00)[0-9]{1,3}[\s.-]?)?[6-9](?:[\s.-]?[0-9]){8}(?![0-9])"),
        # Any number written with an international prefix.
        re.compile(r"(?<![0-9])(?:\+|00)[0-9](?:[\s.-]?[0-9]){7,14}(?![0-9])"),
    ),
    "national_id": (
        re.compile(rf"(?<![A-Za-z0-9])[0-9]{{8}}[\s-]?{_CONTROL_LETTER}(?![A-Za-z0-9])"),
        re.compile(
            rf"(?<![A-Za-z0-9])[XYZxyz][\s-]?[0-9]{{7}}[\s-]?{_CONTROL_LETTER}(?![A-Za-z0-9])"
        ),
    ),
}


def find_identifying_data(text: str) -> list[IdentifyingDataKind]:
    """Which kinds of identifying data the text contains (empty when none)."""
    return [kind for kind, patterns in _PATTERNS.items() if any(p.search(text) for p in patterns)]
