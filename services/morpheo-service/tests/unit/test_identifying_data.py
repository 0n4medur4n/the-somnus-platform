"""The free-text filter behaves exactly like the edge's (shared cases, both languages)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from morpheo.domain.identifying_data import find_identifying_data

CASES = json.loads(
    (
        Path(__file__).resolve().parents[4] / "schemas" / "fixtures" / "identifying-data.json"
    ).read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", CASES["blocked"], ids=lambda case: case["text"])
def test_blocks_identifying_data(case: dict[str, object]) -> None:
    assert find_identifying_data(str(case["text"])) == case["kinds"]


@pytest.mark.parametrize("text", CASES["allowed"])
def test_lets_ordinary_health_text_through(text: str) -> None:
    assert find_identifying_data(text) == []
