"""Scoring: the sum of item values, banded by the official file only."""

from __future__ import annotations

import datetime as dt
from typing import Any

import pytest

from morpheo.instruments.definitions import InstrumentDefinition, parse_definition
from morpheo.instruments.scoring import score

from .synthetic import MARK, official_text, sha256_of, synthetic

TODAY = dt.date(2026, 10, 19)


def _definition(code: str, raw: dict[str, Any] | None = None) -> InstrumentDefinition:
    raw = raw or synthetic(code)
    raw = {**raw, "official_text": {"file": "x", "sha256": sha256_of(raw)}}
    return parse_definition(
        raw, official_text(raw), sha256_of(raw), today=TODAY, allow_synthetic=True
    )


def test_the_total_is_the_sum_and_the_band_comes_from_the_file() -> None:
    isi = _definition("ISI")
    result = score(isi, {f"i{n}": 4 for n in range(1, 8)})
    assert result.total == 28
    assert result.band == isi.bands[-1].label
    assert result.complete
    assert (result.code, result.version) == ("ISI", "test-0")
    assert result.official_sha256 == isi.official_sha256


def test_band_edges_are_inclusive() -> None:
    ess = _definition("ESS")
    edge = ess.bands[0].max  # 12 in the synthetic file
    answers = {f"i{n}": 0 for n in range(1, 9)}
    for n in range(1, edge // 3 + 1):
        answers[f"i{n}"] = 3
    assert score(ess, answers).total == edge
    assert score(ess, answers).band == ess.bands[0].label
    answers["i8"] = 1
    assert score(ess, answers).band == ess.bands[1].label


def test_an_override_of_the_official_scoring_raises_the_band() -> None:
    raw = synthetic("STOP-BANG")
    raw["scoring"]["band_overrides"] = [
        {
            "band": f"{MARK} banda alta",
            "subtotal": {"items": ["i1", "i2", "i3", "i4"], "min": 2},
            "any_of_items": ["i5", "i7", "i8"],
        }
    ]
    stop_bang = _definition("STOP-BANG", raw)
    low = {f"i{n}": 0 for n in range(1, 9)} | {"i1": 1, "i2": 1}
    assert score(stop_bang, low).band == f"{MARK} banda baja"
    assert score(stop_bang, low | {"i8": 1}).band == f"{MARK} banda alta"


def test_an_unanswered_item_is_unknown_not_zero() -> None:
    stop_bang = _definition("STOP-BANG")
    answers: dict[str, int | None] = {f"i{n}": 0 for n in range(1, 9)}
    answers["i8"] = None
    result = score(stop_bang, answers)
    assert result.total is None and result.band is None
    assert result.missing == ("i8",)
    assert not result.complete


def test_an_item_never_answered_is_missing_too() -> None:
    result = score(_definition("ISI"), {"i1": 2})
    assert result.missing == ("i2", "i3", "i4", "i5", "i6", "i7")


def test_a_value_outside_the_items_options_is_refused() -> None:
    with pytest.raises(ValueError, match="invalid response value"):
        score(_definition("STOP-BANG"), {"i1": 2})


def test_an_unknown_item_is_refused() -> None:
    with pytest.raises(ValueError, match="unknown items"):
        score(_definition("ESS"), {"i9": 1})
