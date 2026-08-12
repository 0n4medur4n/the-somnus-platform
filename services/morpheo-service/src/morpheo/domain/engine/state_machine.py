"""The explicit assessment state machine (build plan §14a).

The legal transitions are read from the artifact; any transition not declared
there is rejected. This is the structural guard behind the flow — the engine
never follows an ad-hoc path.
"""

from __future__ import annotations

from collections.abc import Iterable

from morpheo.clinical.models import StateTransition


class IllegalTransitionError(ValueError):
    """Raised when a transition is not declared in the artifact's state machine."""


def legal_transitions(state_machine: Iterable[StateTransition]) -> frozenset[tuple[str, str]]:
    return frozenset((transition.state, transition.next) for transition in state_machine)


def is_legal_transition(transitions: frozenset[tuple[str, str]], frm: str, to: str) -> bool:
    return (frm, to) in transitions


def assert_legal_transition(transitions: frozenset[tuple[str, str]], frm: str, to: str) -> None:
    if not is_legal_transition(transitions, frm, to):
        raise IllegalTransitionError(f"illegal transition {frm!r} -> {to!r}")
