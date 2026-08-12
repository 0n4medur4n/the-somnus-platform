"""Three-valued (Kleene) signals for the rule engine (build plan §14 / §10.1).

Every clinical answer becomes a named signal that is TRUE, FALSE, or — when the
question was not answered — UNKNOWN. The three-valued logic is what makes the
"unknown never defaults to false" policy structural: `unknown OR false` stays
UNKNOWN, never FALSE, so a missing answer can never silently satisfy the
negative of a rule. A safety rule fires only when its condition is definitely
TRUE.
"""

from __future__ import annotations

from collections.abc import Mapping
from enum import Enum


class Ternary(Enum):
    TRUE = "true"
    FALSE = "false"
    UNKNOWN = "unknown"

    def __bool__(self) -> bool:
        raise TypeError("Ternary is three-valued; compare against Ternary.TRUE explicitly")


def as_ternary(value: bool | None) -> Ternary:
    """Map an answer to a signal: True/False are known, None is UNKNOWN."""
    if value is None:
        return Ternary.UNKNOWN
    return Ternary.TRUE if value else Ternary.FALSE


class Signals:
    """An immutable set of named signals; any name not present is UNKNOWN."""

    __slots__ = ("_values",)

    def __init__(self, values: Mapping[str, Ternary] | None = None) -> None:
        self._values: dict[str, Ternary] = dict(values or {})

    @classmethod
    def from_answers(cls, answers: Mapping[str, bool | None]) -> Signals:
        return cls({name: as_ternary(value) for name, value in answers.items()})

    def get(self, name: str) -> Ternary:
        return self._values.get(name, Ternary.UNKNOWN)

    def with_signal(self, name: str, value: Ternary) -> Signals:
        merged = dict(self._values)
        merged[name] = value
        return Signals(merged)

    def names(self) -> frozenset[str]:
        return frozenset(self._values)
