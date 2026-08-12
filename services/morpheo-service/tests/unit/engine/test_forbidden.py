"""Forbidden-phrase scanner (build plan §10.1: catches every BLOQUEAR claim)."""

from __future__ import annotations

from morpheo.clinical.loader import load_clinical
from morpheo.clinical.models import ClaimStatus
from morpheo.domain.engine import build_forbidden_patterns, scan_forbidden

BUNDLE = load_clinical()
PATTERNS = build_forbidden_patterns(
    BUNDLE.workflows.output_contract.forbidden_phrases,
    BUNDLE.workflows.claims_registry,
)
BLOQUEAR = [c for c in BUNDLE.workflows.claims_registry if c.status is ClaimStatus.BLOQUEAR]


def test_every_bloquear_claim_is_caught() -> None:
    assert BLOQUEAR  # there is at least one blocked claim
    for claim in BLOQUEAR:
        assert scan_forbidden(claim.claim, PATTERNS), claim.id


def test_template_with_placeholder_is_caught() -> None:
    # "Tienes [diagnóstico]." must match a concrete diagnosis.
    assert scan_forbidden("Tienes apnea del sueño.", PATTERNS)
    assert scan_forbidden("No tienes narcolepsia.", PATTERNS)


def test_clean_output_has_no_violations() -> None:
    clean = (
        "Resumen de lo comunicado. Nivel de atención y acción concreta. "
        "Esto no es un diagnóstico ni excluye enfermedad."
    )
    assert scan_forbidden(clean, PATTERNS) == ()
