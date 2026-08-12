"""Three-valued signal container."""

from __future__ import annotations

import pytest

from morpheo.domain.engine.signals import Signals, Ternary, as_ternary


def test_as_ternary() -> None:
    assert as_ternary(True) is Ternary.TRUE
    assert as_ternary(False) is Ternary.FALSE
    assert as_ternary(None) is Ternary.UNKNOWN


def test_absent_signal_is_unknown() -> None:
    assert Signals().get("anything") is Ternary.UNKNOWN


def test_from_answers_and_get() -> None:
    signals = Signals.from_answers({"a": True, "b": False, "c": None})
    assert signals.get("a") is Ternary.TRUE
    assert signals.get("b") is Ternary.FALSE
    assert signals.get("c") is Ternary.UNKNOWN
    assert signals.names() == frozenset({"a", "b", "c"})


def test_with_signal_is_immutable() -> None:
    base = Signals.from_answers({"a": True})
    updated = base.with_signal("a", Ternary.FALSE)
    assert base.get("a") is Ternary.TRUE  # original untouched
    assert updated.get("a") is Ternary.FALSE


def test_ternary_is_not_truthy() -> None:
    with pytest.raises(TypeError):
        bool(Ternary.UNKNOWN)
