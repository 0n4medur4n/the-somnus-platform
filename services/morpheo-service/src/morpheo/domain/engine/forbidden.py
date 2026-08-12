"""Forbidden-phrase scanner (build plan §14a / §15).

Deterministic guardrail that no output — however it was worded — states a
diagnosis, an exclusion, a medication instruction, or any other blocked claim.
It is built from the artifact's `output_contract.forbidden_phrases` (templates
with ``[placeholder]`` slots) and every claim marked ``BLOQUEAR`` in the claims
registry. A generative layer never runs before this scan (§14b).
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

from morpheo.clinical.models import ClaimRecord, ClaimStatus


@dataclass(frozen=True)
class ForbiddenPattern:
    source: str
    regex: re.Pattern[str]


def _phrase_to_regex(phrase: str) -> re.Pattern[str]:
    # A ``[placeholder]`` matches any run of text; the rest is literal.
    parts = re.split(r"\[[^\]]*\]", phrase)
    body = ".+?".join(re.escape(part) for part in parts)
    return re.compile(body, re.IGNORECASE)


def build_forbidden_patterns(
    forbidden_phrases: Iterable[str],
    claims: Iterable[ClaimRecord],
) -> tuple[ForbiddenPattern, ...]:
    patterns: list[ForbiddenPattern] = [
        ForbiddenPattern(source=phrase, regex=_phrase_to_regex(phrase))
        for phrase in forbidden_phrases
    ]
    patterns.extend(
        ForbiddenPattern(source=claim.claim, regex=_phrase_to_regex(claim.claim))
        for claim in claims
        if claim.status is ClaimStatus.BLOQUEAR
    )
    return tuple(patterns)


def scan_forbidden(text: str, patterns: Iterable[ForbiddenPattern]) -> tuple[str, ...]:
    """Return the source phrases whose pattern matched the text (empty = clean)."""
    return tuple(pattern.source for pattern in patterns if pattern.regex.search(text))
