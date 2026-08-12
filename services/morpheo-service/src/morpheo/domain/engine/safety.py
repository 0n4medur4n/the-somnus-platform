"""The safety gate (build plan §14a): evaluate the nine safety rules over the
signals, in priority order, and return the governing urgency level.

Safety is 100 % rule-driven — the engine evaluates the artifact's own `when`
conditions, never a hand-coded rule. Levels L0 (emergency) … L2 (priority) come
only from these rules; L3/L4 (scheduled / information) are the non-urgent
orientation and are decided in the profile, not here. Because the grammar has no
negation, turning a signal TRUE can only add triggers, so the level is
monotonic: it never becomes *less* urgent as answers accumulate.
"""

from __future__ import annotations

from dataclasses import dataclass

from morpheo.clinical.models import SafetyLevelId, SafetyRule

from .boolean import evaluate_condition
from .signals import Signals, Ternary

# Lower rank == more urgent (L0 is the emergency).
_URGENCY: dict[SafetyLevelId, int] = {
    SafetyLevelId.L0: 0,
    SafetyLevelId.L1: 1,
    SafetyLevelId.L2: 2,
    SafetyLevelId.L3: 3,
    SafetyLevelId.L4: 4,
}


def urgency_rank(level: SafetyLevelId) -> int:
    return _URGENCY[level]


@dataclass(frozen=True)
class SafetyOutcome:
    """The result of the safety gate. `level` is None when no rule fires."""

    level: SafetyLevelId | None
    stop: bool
    triggered_rule_ids: tuple[str, ...]
    message: str | None

    @property
    def fired(self) -> bool:
        return self.level is not None


def _governing_key(rule: SafetyRule) -> tuple[int, int]:
    # Most urgent first; ties broken by the higher (numerically larger) priority.
    return (urgency_rank(rule.level), -rule.priority)


def run_safety_gate(rules: list[SafetyRule], signals: Signals) -> SafetyOutcome:
    """Return the governing safety outcome for the given signals."""
    triggered = [rule for rule in rules if evaluate_condition(rule.when, signals) is Ternary.TRUE]
    if not triggered:
        return SafetyOutcome(level=None, stop=False, triggered_rule_ids=(), message=None)

    ordered = sorted(triggered, key=_governing_key)
    governing = ordered[0]
    return SafetyOutcome(
        level=governing.level,
        stop=governing.stop,
        triggered_rule_ids=tuple(rule.id for rule in ordered),
        message=governing.message,
    )
