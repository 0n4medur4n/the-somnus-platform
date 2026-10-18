"""Loading the licensed instrument files.

Each instrument is one JSON file, `<CODE>.json` (ISI.json, ESS.json,
STOP-BANG.json), in INSTRUMENTS_SOURCE_DIR. The file is the licensor's
validated Spanish version transcribed as delivered: instructions, items,
response options and the scoring bands of its manual. Nothing here supplies
or alters that text. What the code does know is only each instrument's shape
(how many items, which response values), to refuse a wrong or damaged file.

The loader fails closed: with the switch on, a missing, malformed, synthetic
or expired file stops the service at startup instead of showing a partial
questionnaire. Every definition carries the file's SHA-256, so each result
records exactly which licensed version the person answered.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from morpheo.settings.config import Settings

LANGUAGE = "es-ES"
SYNTHETIC_MARK = "SINTÉTICO"


class InstrumentConfigError(ValueError):
    """An instrument file is missing, malformed, synthetic or out of licence."""


@dataclass(frozen=True)
class Shape:
    """What the code may know: structure only, never wording or cut-offs."""

    items: int
    values: frozenset[int]


SHAPES: dict[str, Shape] = {
    "ISI": Shape(items=7, values=frozenset(range(5))),
    "ESS": Shape(items=8, values=frozenset(range(4))),
    "STOP-BANG": Shape(items=8, values=frozenset({0, 1})),
}


@dataclass(frozen=True)
class Option:
    value: int
    label: str


@dataclass(frozen=True)
class Item:
    id: str
    text: str
    options: tuple[Option, ...]


@dataclass(frozen=True)
class Band:
    min: int
    max: int
    label: str


@dataclass(frozen=True)
class Licence:
    licensor: str
    reference: str
    valid_until: dt.date


@dataclass(frozen=True)
class InstrumentDefinition:
    code: str
    name: str
    language: str
    version: str
    licence: Licence
    instructions: str
    items: tuple[Item, ...]
    bands: tuple[Band, ...]
    source_sha256: str
    synthetic: bool


@dataclass(frozen=True)
class InstrumentRegistry:
    definitions: dict[str, InstrumentDefinition]

    @property
    def enabled(self) -> bool:
        return bool(self.definitions)


DISABLED = InstrumentRegistry(definitions={})


def _text(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InstrumentConfigError(f"{where}: empty text")
    return value


def parse_definition(
    raw: dict[str, Any],
    sha256: str,
    *,
    today: dt.date,
    allow_synthetic: bool = False,
) -> InstrumentDefinition:
    code = raw.get("instrument")
    if code not in SHAPES:
        raise InstrumentConfigError(f"unknown instrument {code!r}")
    shape = SHAPES[code]
    synthetic = raw.get("synthetic") is True
    if synthetic and not allow_synthetic:
        raise InstrumentConfigError(f"{code}: synthetic test file, not the licensed version")
    if raw.get("language") != LANGUAGE:
        raise InstrumentConfigError(f"{code}: language must be {LANGUAGE}")
    licence_raw = raw.get("licence") or {}
    try:
        valid_until = dt.date.fromisoformat(licence_raw.get("valid_until", ""))
    except ValueError as exc:
        raise InstrumentConfigError(f"{code}: licence.valid_until is not a date") from exc
    if valid_until < today:
        raise InstrumentConfigError(f"{code}: licence expired on {valid_until.isoformat()}")
    licence = Licence(
        licensor=_text(licence_raw.get("licensor"), f"{code} licence.licensor"),
        reference=_text(licence_raw.get("reference"), f"{code} licence.reference"),
        valid_until=valid_until,
    )
    items_raw = raw.get("items") or []
    if len(items_raw) != shape.items:
        raise InstrumentConfigError(f"{code}: {len(items_raw)} items, expected {shape.items}")
    items: list[Item] = []
    for i, item in enumerate(items_raw):
        where = f"{code} item {i + 1}"
        options = tuple(
            Option(int(o["value"]), _text(o.get("label"), f"{where} option"))
            for o in item.get("options", [])
        )
        if {o.value for o in options} != shape.values or len(options) != len(shape.values):
            raise InstrumentConfigError(f"{where}: response values must be {sorted(shape.values)}")
        items.append(
            Item(_text(item.get("id"), f"{where} id"), _text(item.get("text"), where), options)
        )
    if len({item.id for item in items}) != len(items):
        raise InstrumentConfigError(f"{code}: duplicate item ids")
    bands = _bands(code, raw.get("scoring") or {}, shape)
    instructions = _text(raw.get("instructions"), f"{code} instructions")
    if not synthetic:
        texts = [instructions, *(i.text for i in items), *(b.label for b in bands)]
        if any(SYNTHETIC_MARK in t for t in texts):
            raise InstrumentConfigError(f"{code}: synthetic text in a file not marked synthetic")
    return InstrumentDefinition(
        code=code,
        name=_text(raw.get("name"), f"{code} name"),
        language=LANGUAGE,
        version=_text(raw.get("version"), f"{code} version"),
        licence=licence,
        instructions=instructions,
        items=tuple(items),
        bands=bands,
        source_sha256=sha256,
        synthetic=synthetic,
    )


def _bands(code: str, scoring: dict[str, Any], shape: Shape) -> tuple[Band, ...]:
    if scoring.get("method") != "sum":
        raise InstrumentConfigError(f"{code}: only the sum of item values is supported")
    low, high = min(shape.values) * shape.items, max(shape.values) * shape.items
    bands = tuple(
        Band(int(b["min"]), int(b["max"]), _text(b.get("label"), f"{code} band"))
        for b in scoring.get("bands", [])
    )
    # The manual's bands must cover every possible total exactly once.
    expected = low
    for band in sorted(bands, key=lambda b: b.min):
        if band.min != expected or band.max < band.min:
            raise InstrumentConfigError(f"{code}: bands must cover {low}-{high} without gaps")
        expected = band.max + 1
    if not bands or expected != high + 1:
        raise InstrumentConfigError(f"{code}: bands must cover {low}-{high} without gaps")
    return tuple(sorted(bands, key=lambda b: b.min))


def load_definition(
    path: Path, *, today: dt.date, allow_synthetic: bool = False
) -> InstrumentDefinition:
    data = path.read_bytes()
    try:
        raw = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InstrumentConfigError(f"{path.name}: not valid UTF-8 JSON") from exc
    if not isinstance(raw, dict):
        raise InstrumentConfigError(f"{path.name}: not an instrument definition")
    try:
        definition = parse_definition(
            raw, hashlib.sha256(data).hexdigest(), today=today, allow_synthetic=allow_synthetic
        )
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, InstrumentConfigError):
            raise
        raise InstrumentConfigError(f"{path.name}: malformed ({exc!r})") from exc
    if path.stem != definition.code:
        raise InstrumentConfigError(f"{path.name}: holds {definition.code}")
    return definition


def load_registry(
    settings: Settings, *, today: dt.date | None = None, allow_synthetic: bool = False
) -> InstrumentRegistry:
    """The instruments to offer: none while the switch is off (nothing is read).

    With the switch on, every licensed file in the directory is loaded and must
    be valid; licences may arrive one at a time, so not all three are required,
    but at least one is.
    """
    if not settings.instruments_enabled:
        return DISABLED
    if not settings.instruments_source_dir:
        raise InstrumentConfigError("INSTRUMENTS_ENABLED needs INSTRUMENTS_SOURCE_DIR")
    directory = Path(settings.instruments_source_dir)
    if not directory.is_dir():
        raise InstrumentConfigError("INSTRUMENTS_SOURCE_DIR is not a directory")
    today = today or dt.datetime.now(dt.UTC).date()
    definitions = {}
    for path in sorted(directory.glob("*.json")):
        if path.stem not in SHAPES:
            raise InstrumentConfigError(f"unexpected file {path.name}")
        definitions[path.stem] = load_definition(path, today=today, allow_synthetic=allow_synthetic)
    if not definitions:
        raise InstrumentConfigError("INSTRUMENTS_ENABLED but no licensed file was found")
    return InstrumentRegistry(definitions=definitions)
