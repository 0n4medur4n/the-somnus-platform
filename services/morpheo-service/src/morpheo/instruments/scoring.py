"""Scoring a completed instrument with its original scoring and cut-offs.

Deterministic and generic: the total is the sum of item values, the band comes
from the official file's cut-offs (v0.2 p. 14: "conservar sus puntos de corte"),
and an override of the official scoring (STOP-Bang) can raise it. An
unanswered item is unknown, never zero (R03): with any item missing there is
no total and no band.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from morpheo.instruments.definitions import InstrumentDefinition


@dataclass(frozen=True)
class InstrumentResult:
    code: str
    version: str
    official_sha256: str
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
            definition.official_sha256,
            None,
            None,
            tuple(missing),
        )
    band = next(b.label for b in definition.bands if b.min <= total <= b.max)
    order = [b.label for b in definition.bands]
    for override in definition.overrides:
        subtotal = sum(responses[i] or 0 for i in override.subtotal_items)
        any_hit = not override.any_items or any(responses[i] for i in override.any_items)
        # An override only ever raises the band, never lowers it.
        if (
            subtotal >= override.subtotal_min
            and any_hit
            and (order.index(override.label) > order.index(band))
        ):
            band = override.label
    return InstrumentResult(
        definition.code, definition.version, definition.official_sha256, total, band, ()
    )
