"""The explicit state machine: legal transitions from the artifact, illegal
transitions rejected (build plan §10.1)."""

from __future__ import annotations

import pytest

from morpheo.clinical.loader import load_clinical
from morpheo.domain.engine import (
    IllegalTransitionError,
    assert_legal_transition,
    is_legal_transition,
    legal_transitions,
)

TRANSITIONS = legal_transitions(load_clinical().workflows.state_machine)


def test_declared_transitions_are_legal() -> None:
    assert is_legal_transition(TRANSITIONS, "START", "ROLE_SELECTED")
    assert is_legal_transition(TRANSITIONS, "SAFETY_GATE", "ESCALATED")
    assert is_legal_transition(TRANSITIONS, "OUTPUT_READY", "END")


def test_undeclared_transition_is_illegal() -> None:
    assert not is_legal_transition(TRANSITIONS, "START", "END")
    assert not is_legal_transition(TRANSITIONS, "OUTPUT_READY", "NOWHERE")


def test_assert_legal_transition_raises_on_illegal() -> None:
    assert_legal_transition(TRANSITIONS, "START", "ROLE_SELECTED")  # no raise
    with pytest.raises(IllegalTransitionError):
        assert_legal_transition(TRANSITIONS, "START", "OUTPUT_READY")
