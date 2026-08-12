"""The `when` parser + Kleene evaluator."""

from __future__ import annotations

import pytest

from morpheo.domain.engine import (
    BooleanExpressionError,
    condition_atoms,
    evaluate_condition,
    parse_condition,
)
from morpheo.domain.engine.signals import Signals, Ternary

T, F, U = Ternary.TRUE, Ternary.FALSE, Ternary.UNKNOWN


def _sig(**kwargs: Ternary) -> Signals:
    return Signals(dict(kwargs))


def test_single_atom() -> None:
    assert evaluate_condition("a", _sig(a=T)) is T
    assert evaluate_condition("a", _sig(a=F)) is F
    assert evaluate_condition("a", Signals()) is U  # absent -> unknown


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [(T, T, T), (T, F, F), (F, F, F), (T, U, U), (F, U, F), (U, U, U)],
)
def test_and_kleene(a: Ternary, b: Ternary, expected: Ternary) -> None:
    assert evaluate_condition("a AND b", _sig(a=a, b=b)) is expected


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [(T, T, T), (T, F, T), (F, F, F), (T, U, T), (F, U, U), (U, U, U)],
)
def test_or_kleene(a: Ternary, b: Ternary, expected: Ternary) -> None:
    assert evaluate_condition("a OR b", _sig(a=a, b=b)) is expected


def test_precedence_and_parentheses() -> None:
    # a AND (b OR c): the artifact's SAFE-006 shape.
    assert evaluate_condition("a AND (b OR c)", _sig(a=T, b=F, c=T)) is T
    assert evaluate_condition("a AND (b OR c)", _sig(a=T, b=F, c=F)) is F
    # Without parentheses, AND binds tighter than OR.
    assert evaluate_condition("a OR b AND c", _sig(a=T, b=F, c=F)) is T


def test_condition_atoms() -> None:
    assert condition_atoms("a AND (b OR c)") == frozenset({"a", "b", "c"})


@pytest.mark.parametrize(
    "text",
    ["", "   ", "(a", "a b", "AND a", "a AND", "(a OR)", ")a("],
)
def test_malformed_conditions_raise(text: str) -> None:
    with pytest.raises(BooleanExpressionError):
        parse_condition(text)


def test_unexpected_character_raises() -> None:
    with pytest.raises(BooleanExpressionError):
        parse_condition("a & b")
