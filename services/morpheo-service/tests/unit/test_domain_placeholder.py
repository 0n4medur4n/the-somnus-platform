"""Establishes the domain/ testing pattern: pure functions, no fixtures, no I/O."""

from __future__ import annotations

from morpheo.domain.placeholder import echo


def test_echo_returns_input_unchanged() -> None:
    assert echo("hello") == "hello"
    assert echo("") == ""
