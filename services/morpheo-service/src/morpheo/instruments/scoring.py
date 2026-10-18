"""Scoring a completed instrument: the sum of item values, banded by its manual.

Deterministic and generic: the bands (cut-offs and labels) come only from the
licensed file, kept as validated (v0.2 p. 14). An unanswered item is unknown,
never zero (R03): with any item missing there is no total and no band.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from morpheo.instruments.definitions import InstrumentDefinition


@dataclass(frozen=True)
class InstrumentResult:
    code: str
    version: str
    source_sha256: str
    total: int | None
    band: str | None
    missing: tuple[str, ...]

    @property
    def complete(self) -> bool:
        return not self.missing


def score(
    definition: InstrumentDefinition, responses: Mapping[str, int | None]
) -> InstrumentResult:
    known = {item.id: item for item in definition.items}
    unknown = sorted(set(responses) - set(known))
    if unknown:
        raise ValueError(f"{definition.code}: unknown items {unknown}")
    missing: list[str] = []
    total = 0
    for item in definition.items:
        value = responses.get(item.id)
        if value is None:
            missing.append(item.id)
            continue
        if value not in {o.value for o in item.options}:
            raise ValueError(f"{definition.code} item {item.id}: invalid response value")
        total += value
    if missing:
        return InstrumentResult(
            definition.code,
            definition.version,
            definition.source_sha256,
            None,
            None,
            tuple(missing),
        )
    band = next(b.label for b in definition.bands if b.min <= total <= b.max)
    return InstrumentResult(
        definition.code, definition.version, definition.source_sha256, total, band, ()
    )
