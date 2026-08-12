"""A tiny parser + Kleene evaluator for the safety rules' `when` conditions.

The artifact expresses conditions as boolean expressions over named signal
atoms, e.g. ``witnessed_apneas AND (marked_sleepiness OR significant_deterioration)``.
The grammar is deliberately minimal — identifiers, ``AND``, ``OR``, parentheses,
no negation — so the engine evaluates the artifact's own rule text rather than
restating it in code. The absence of negation also guarantees monotonicity:
turning an UNKNOWN signal TRUE can never make a TRUE condition FALSE.

Grammar::

    expr   := term  (OR term)*
    term   := factor (AND factor)*
    factor := IDENT | '(' expr ')'
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .signals import Signals, Ternary

_TOKEN = re.compile(r"\s*(?:(?P<op>AND|OR)|(?P<lp>\()|(?P<rp>\))|(?P<ident>[a-z][a-z0-9_]*))")


class BooleanExpressionError(ValueError):
    """Raised when a `when` condition is malformed."""


@dataclass(frozen=True)
class _Ident:
    name: str


@dataclass(frozen=True)
class _And:
    parts: tuple[_Node, ...]


@dataclass(frozen=True)
class _Or:
    parts: tuple[_Node, ...]


_Node = _Ident | _And | _Or


def _tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    pos = 0
    while pos < len(text):
        if text[pos].isspace():
            pos += 1
            continue
        match = _TOKEN.match(text, pos)
        if match is None or match.end() == pos:
            raise BooleanExpressionError(f"unexpected token in {text!r} at position {pos}")
        pos = match.end()
        tokens.append(match.group().strip())
    return tokens


class _Parser:
    def __init__(self, tokens: list[str]) -> None:
        self._tokens = tokens
        self._pos = 0

    def _peek(self) -> str | None:
        return self._tokens[self._pos] if self._pos < len(self._tokens) else None

    def _advance(self) -> str:
        token = self._tokens[self._pos]
        self._pos += 1
        return token

    def parse(self) -> _Node:
        node = self._expr()
        if self._peek() is not None:
            rest = self._tokens[self._pos :]
            raise BooleanExpressionError(f"trailing tokens after expression: {rest}")
        return node

    def _expr(self) -> _Node:
        parts = [self._term()]
        while self._peek() == "OR":
            self._advance()
            parts.append(self._term())
        return parts[0] if len(parts) == 1 else _Or(tuple(parts))

    def _term(self) -> _Node:
        parts = [self._factor()]
        while self._peek() == "AND":
            self._advance()
            parts.append(self._factor())
        return parts[0] if len(parts) == 1 else _And(tuple(parts))

    def _factor(self) -> _Node:
        token = self._peek()
        if token is None:
            raise BooleanExpressionError("unexpected end of expression")
        if token == "(":
            self._advance()
            node = self._expr()
            if self._peek() != ")":
                raise BooleanExpressionError("missing closing parenthesis")
            self._advance()
            return node
        if token in {"AND", "OR", ")"}:
            raise BooleanExpressionError(f"unexpected {token!r}")
        return _Ident(self._advance())


def parse_condition(text: str) -> _Node:
    """Parse a `when` expression into an evaluable node (raises on malformed text)."""
    tokens = _tokenize(text)
    if not tokens:
        raise BooleanExpressionError("empty condition")
    return _Parser(tokens).parse()


def _eval(node: _Node, signals: Signals) -> Ternary:
    if isinstance(node, _Ident):
        return signals.get(node.name)
    children = [_eval(part, signals) for part in node.parts]
    if isinstance(node, _And):
        if any(c is Ternary.FALSE for c in children):
            return Ternary.FALSE
        if any(c is Ternary.UNKNOWN for c in children):
            return Ternary.UNKNOWN
        return Ternary.TRUE
    # _Or
    if any(c is Ternary.TRUE for c in children):
        return Ternary.TRUE
    if any(c is Ternary.UNKNOWN for c in children):
        return Ternary.UNKNOWN
    return Ternary.FALSE


def evaluate_condition(text: str, signals: Signals) -> Ternary:
    """Kleene-evaluate a `when` condition against the signals."""
    return _eval(parse_condition(text), signals)


def condition_atoms(text: str) -> frozenset[str]:
    """The signal names a condition references (for validation/coverage)."""

    def collect(node: _Node) -> frozenset[str]:
        if isinstance(node, _Ident):
            return frozenset({node.name})
        return frozenset().union(*(collect(part) for part in node.parts))

    return collect(parse_condition(text))
