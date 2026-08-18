"""The forbidden-phrase scanner (build plan §15 / Checkpoint 11.2)."""

from __future__ import annotations

from report.infrastructure.forbidden import ForbiddenPhraseScanner
from report.schemas.render import ClinicalContentDTO


def test_blocks_a_bloquear_claim_statement(content: ClinicalContentDTO) -> None:
    scanner = ForbiddenPhraseScanner.from_content(content)
    assert scanner.is_blocked("Recuerda: Morpheo sustituye una consulta médica o pediátrica.")
    assert "Morpheo sustituye una consulta médica o pediátrica." in scanner.scan(
        "Morpheo sustituye una consulta médica o pediátrica."
    )


def test_blocks_a_forbidden_template_however_worded(content: ClinicalContentDTO) -> None:
    # "Tienes [diagnóstico]." is a template: [placeholder] matches any diagnosis.
    scanner = ForbiddenPhraseScanner.from_content(content)
    assert scanner.is_blocked("Según esto, tienes insomnio crónico.")
    assert scanner.is_blocked("No tienes apnea del sueño.")


def test_allows_approved_prose(content: ClinicalContentDTO) -> None:
    scanner = ForbiddenPhraseScanner.from_content(content)
    clean = "Conviene que valores estos síntomas con un profesional cuando puedas."
    assert scanner.is_blocked(clean) is False
    assert scanner.scan(clean) == []
