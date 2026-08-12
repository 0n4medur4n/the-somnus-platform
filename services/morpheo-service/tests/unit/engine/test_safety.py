"""Every safety rule, triggered and not triggered, plus governing selection.

Driven from the artifact so all nine rules are covered in both directions
(build plan §10.1: 100 % of safety rules)."""

from __future__ import annotations

import pytest

from morpheo.clinical.loader import load_clinical
from morpheo.clinical.models import SafetyLevelId, SafetyRule
from morpheo.domain.engine import condition_atoms, run_safety_gate
from morpheo.domain.engine.signals import Signals, Ternary

RULES = load_clinical().workflows.safety_rules
_IDS = [rule.id for rule in RULES]


def _all(atoms: frozenset[str], value: Ternary) -> Signals:
    return Signals(dict.fromkeys(atoms, value))


@pytest.mark.parametrize("rule", RULES, ids=_IDS)
def test_rule_triggers_when_all_its_atoms_are_true(rule: SafetyRule) -> None:
    outcome = run_safety_gate([rule], _all(condition_atoms(rule.when), Ternary.TRUE))
    assert outcome.fired
    assert outcome.level is rule.level
    assert outcome.stop is rule.stop
    assert outcome.triggered_rule_ids == (rule.id,)
    assert outcome.message == rule.message


@pytest.mark.parametrize("rule", RULES, ids=_IDS)
def test_rule_does_not_trigger_when_all_its_atoms_are_false(rule: SafetyRule) -> None:
    outcome = run_safety_gate([rule], _all(condition_atoms(rule.when), Ternary.FALSE))
    assert not outcome.fired


@pytest.mark.parametrize("rule", RULES, ids=_IDS)
def test_rule_does_not_trigger_when_all_its_atoms_are_unknown(rule: SafetyRule) -> None:
    outcome = run_safety_gate([rule], _all(condition_atoms(rule.when), Ternary.UNKNOWN))
    assert not outcome.fired


def test_no_rule_triggers_returns_no_level() -> None:
    outcome = run_safety_gate(RULES, Signals())
    assert not outcome.fired
    assert outcome.level is None
    assert outcome.triggered_rule_ids == ()


def test_governing_outcome_is_the_most_urgent_triggered_rule() -> None:
    # Trigger an L0 rule (SAFE-002) and an L2 rule (SAFE-007) at once.
    signals = Signals(
        {
            "immediate_self_harm_or_harm_to_others": Ternary.TRUE,
            "possible_cataplexy": Ternary.TRUE,
        }
    )
    outcome = run_safety_gate(RULES, signals)
    assert outcome.level is SafetyLevelId.L0
    assert outcome.stop is True
    assert outcome.triggered_rule_ids[0] == "SAFE-002"
    assert "SAFE-007" in outcome.triggered_rule_ids


def test_same_level_tie_is_broken_toward_the_stopping_rule() -> None:
    # SAFE-003 (L1, stop, priority 950) and SAFE-005 (L1, no stop, priority 930).
    signals = Signals(
        {
            "sleepiness_near_miss": Ternary.TRUE,
            "recent_violent_or_injurious_sleep_behavior": Ternary.TRUE,
        }
    )
    outcome = run_safety_gate(RULES, signals)
    assert outcome.level is SafetyLevelId.L1
    assert outcome.stop is True
    assert outcome.triggered_rule_ids[0] == "SAFE-003"
