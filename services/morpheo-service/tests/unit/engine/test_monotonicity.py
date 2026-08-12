"""Property test (build plan §10.1): adding an answer never lowers the safety
level. Because the rule grammar has no negation, turning a signal TRUE can only
add triggers, so the governing urgency can never become *less* urgent."""

from __future__ import annotations

import random

from morpheo.clinical.loader import load_clinical
from morpheo.domain.engine import condition_atoms, run_safety_gate, urgency_rank
from morpheo.domain.engine.signals import Signals, Ternary

RULES = load_clinical().workflows.safety_rules
ALL_ATOMS = sorted(set().union(*(condition_atoms(rule.when) for rule in RULES)))

_NOT_FIRED_RANK = 99  # less urgent than any real level


def _rank(signals: Signals) -> int:
    outcome = run_safety_gate(RULES, signals)
    return urgency_rank(outcome.level) if outcome.level is not None else _NOT_FIRED_RANK


def test_turning_any_signal_true_never_lowers_urgency() -> None:
    rng = random.Random(20260813)
    for _ in range(1000):
        chosen = rng.sample(ALL_ATOMS, k=rng.randint(0, len(ALL_ATOMS)))
        base = Signals({atom: rng.choice(list(Ternary)) for atom in chosen})
        before = _rank(base)
        flipped = base.with_signal(rng.choice(ALL_ATOMS), Ternary.TRUE)
        after = _rank(flipped)
        # Lower rank == more urgent; it must never increase (never less urgent).
        assert after <= before
