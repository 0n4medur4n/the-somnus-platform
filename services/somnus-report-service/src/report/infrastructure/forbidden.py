"""Forbidden-phrase scanner (build plan §15 / Checkpoint 11.2).

A deterministic guardrail run on AI-reworded output. It is LITERAL: it blocks the
governed phrases and their `[placeholder]` variants (case-insensitive) — Morpheo's
`forbiddenPhrases` (templates with `[placeholder]` slots that match any run of
text) + every BLOQUEAR claim statement (`blockedClaims`), the single governed
source fetched from Morpheo. It mirrors morpheo's own scanner.

Residual risk (accepted): being literal, it does NOT catch an arbitrary PARAPHRASE
that avoids the exact wording, nor Unicode/whitespace obfuscation. The scanner is a
backstop; the primary control against paraphrased claims is the `pending_review`
human gate — AI text is never served until a person approves it. See
tests/unit/test_rewriter.py::test_residual_risk_a_paraphrased_claim_is_not_caught.
"""

from __future__ import annotations

import re

from report.schemas.render import ClinicalContentDTO


def _to_regex(phrase: str) -> re.Pattern[str]:
    # A `[placeholder]` matches any run of text; the rest is literal, case-insensitive.
    parts = re.split(r"\[[^\]]*\]", phrase)
    body = ".+?".join(re.escape(part) for part in parts)
    return re.compile(body, re.IGNORECASE)


class ForbiddenPhraseScanner:
    def __init__(self, forbidden_phrases: list[str], blocked_claims: list[str]) -> None:
        self._patterns: list[tuple[str, re.Pattern[str]]] = [
            (phrase, _to_regex(phrase)) for phrase in (*forbidden_phrases, *blocked_claims)
        ]

    @classmethod
    def from_content(cls, content: ClinicalContentDTO) -> ForbiddenPhraseScanner:
        return cls(content.output_contract.forbidden_phrases, content.blocked_claims)

    def scan(self, text: str) -> list[str]:
        """The source phrases this text matches (empty when clean)."""
        return [source for source, pattern in self._patterns if pattern.search(text)]

    def is_blocked(self, text: str) -> bool:
        return any(pattern.search(text) for _, pattern in self._patterns)
