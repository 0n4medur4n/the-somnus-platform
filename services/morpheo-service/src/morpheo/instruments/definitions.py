"""Loading the official instrument files (ISI, Epworth, STOP-Bang).

Each instrument is a versioned structured file in the clinical artifacts,
`clinical/instruments/<CODE>.json` (ISI.json, ESS.json, STOP-BANG.json), next
to the official Spanish text it was transcribed from (`official_text.file`),
as delivered with the licence. At startup the loader checks, like the v0.2
questions:

* the official text's SHA-256 matches the one the file records;
* the instructions, every item, every response option and every band label
  are word for word in that official text (only runs of whitespace are
  normalised, since a line break in the original is not a change of wording);
* the structure matches the instrument (how many items, which values) -- the
  only thing the code itself knows; wording and cut-offs come from the file.

An instrument whose file has not arrived is *pending*: the interview skips it
and the team panel says so. A file that is present but wrong stops the service
at startup -- a wrong questionnaire is never shown.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from morpheo.settings.config import Settings

INSTRUMENTS_DIR = Path(__file__).resolve().parents[3] / "clinical" / "instruments"
LANGUAGE = "es-ES"
SYNTHETIC_MARK = "SINTÉTICO"


class InstrumentConfigError(ValueError):
    """An instrument file is malformed, synthetic, out of licence or not verbatim."""


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
class BandOverride:
    """A rule of the official scoring that sets the band beyond the total
    (STOP-Bang: a subtotal of some items plus any of others). All conditions
    must hold."""

    label: str
    subtotal_items: tuple[str, ...] = ()
    subtotal_min: int = 0
    any_items: tuple[str, ...] = ()


@dataclass(frozen=True)
class Licence:
    source: str
    reference: str
    valid_until: dt.date | None


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
    overrides: tuple[BandOverride, ...]
    official_sha256: str
    synthetic: bool


@dataclass(frozen=True)
class InstrumentRegistry:
    """The instruments loaded, and those switched on but still without a file."""

    definitions: dict[str, InstrumentDefinition]
    pending: tuple[str, ...] = field(default=())

    @property
    def enabled(self) -> bool:
        return bool(self.definitions) or bool(self.pending)


DISABLED = InstrumentRegistry(definitions={})


def _text(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InstrumentConfigError(f"{where}: empty text")
    return value


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _check_verbatim(text: str, official: str, where: str) -> None:
    if _normalise(text) not in official:
        raise InstrumentConfigError(f"{where}: not word for word in the official text")


def parse_definition(
    raw: dict[str, Any],
    official_text: str,
    official_sha256: str,
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
        raise InstrumentConfigError(f"{code}: synthetic test file, not the official version")
    if raw.get("language") != LANGUAGE:
        raise InstrumentConfigError(f"{code}: language must be {LANGUAGE}")
    recorded = (raw.get("official_text") or {}).get("sha256")
    if recorded != official_sha256:
        raise InstrumentConfigError(f"{code}: the official text's SHA-256 does not match")
    official = _normalise(official_text)

    licence_raw = raw.get("licence") or {}
    valid_until_raw = licence_raw.get("valid_until")
    try:
        valid_until = dt.date.fromisoformat(valid_until_raw) if valid_until_raw else None
    except ValueError as exc:
        raise InstrumentConfigError(f"{code}: licence.valid_until is not a date") from exc
    if valid_until is not None and valid_until < today:
        raise InstrumentConfigError(f"{code}: licence expired on {valid_until.isoformat()}")
    licence = Licence(
        source=_text(licence_raw.get("source"), f"{code} licence.source"),
        reference=_text(licence_raw.get("reference"), f"{code} licence.reference"),
        valid_until=valid_until,
    )

    instructions = _text(raw.get("instructions"), f"{code} instructions")
    _check_verbatim(instructions, official, f"{code} instructions")
    items_raw = raw.get("items") or []
    if len(items_raw) != shape.items:
        raise InstrumentConfigError(f"{code}: {len(items_raw)} items, expected {shape.items}")
    items: list[Item] = []
    for i, item in enumerate(items_raw):
        where = f"{code} item {i + 1}"
        text = _text(item.get("text"), where)
        _check_verbatim(text, official, where)
        options = tuple(
            Option(int(o["value"]), _text(o.get("label"), f"{where} option"))
            for o in item.get("options", [])
        )
        if {o.value for o in options} != shape.values or len(options) != len(shape.values):
            raise InstrumentConfigError(f"{where}: response values must be {sorted(shape.values)}")
        for option in options:
            _check_verbatim(option.label, official, f"{where} option {option.value}")
        items.append(Item(_text(item.get("id"), f"{where} id"), text, options))
    if len({item.id for item in items}) != len(items):
        raise InstrumentConfigError(f"{code}: duplicate item ids")
    scoring = raw.get("scoring") or {}
    bands = _bands(code, scoring, shape)
    for band in bands:
        _check_verbatim(band.label, official, f"{code} band {band.min}-{band.max}")
    overrides = _overrides(code, scoring, {item.id for item in items}, {b.label for b in bands})
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
        overrides=overrides,
        official_sha256=official_sha256,
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
    # The manual's cut-offs must cover every possible total exactly once.
    expected = low
    for band in sorted(bands, key=lambda b: b.min):
        if band.min != expected or band.max < band.min:
            raise InstrumentConfigError(f"{code}: bands must cover {low}-{high} without gaps")
        expected = band.max + 1
    if not bands or expected != high + 1:
        raise InstrumentConfigError(f"{code}: bands must cover {low}-{high} without gaps")
    return tuple(sorted(bands, key=lambda b: b.min))


def _overrides(
    code: str, scoring: dict[str, Any], item_ids: set[str], labels: set[str]
) -> tuple[BandOverride, ...]:
    out: list[BandOverride] = []
    for raw in scoring.get("band_overrides", []):
        override = BandOverride(
            label=_text(raw.get("band"), f"{code} band override"),
            subtotal_items=tuple(raw.get("subtotal", {}).get("items", [])),
            subtotal_min=int(raw.get("subtotal", {}).get("min", 0)),
            any_items=tuple(raw.get("any_of_items", [])),
        )
        if override.label not in labels:
            raise InstrumentConfigError(f"{code}: band override names an unknown band")
        if not set(override.subtotal_items + override.any_items) <= item_ids:
            raise InstrumentConfigError(f"{code}: band override names an unknown item")
        out.append(override)
    return tuple(out)


def load_definition(
    path: Path, *, today: dt.date, allow_synthetic: bool = False
) -> InstrumentDefinition:
    try:
        raw = json.loads(path.read_bytes().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InstrumentConfigError(f"{path.name}: not valid UTF-8 JSON") from exc
    if not isinstance(raw, dict):
        raise InstrumentConfigError(f"{path.name}: not an instrument definition")
    text_name = (raw.get("official_text") or {}).get("file")
    if not isinstance(text_name, str) or "/" in text_name or "\\" in text_name:
        raise InstrumentConfigError(f"{path.name}: official_text.file must name a file beside it")
    text_path = path.parent / text_name
    if not text_path.is_file():
        raise InstrumentConfigError(f"{path.name}: the official text {text_name} is missing")
    data = text_path.read_bytes()
    try:
        official_text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise InstrumentConfigError(f"{text_name}: the official text is not UTF-8") from exc
    try:
        definition = parse_definition(
            raw,
            official_text,
            hashlib.sha256(data).hexdigest(),
            today=today,
            allow_synthetic=allow_synthetic,
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
    """The instruments to offer.

    Switch off: none, and nothing is read. Switch on: every official file
    present is loaded and must be valid; an instrument with no file yet is
    pending, and the interview skips it.
    """
    if not settings.instruments_enabled:
        return DISABLED
    directory = Path(settings.instruments_source_dir or INSTRUMENTS_DIR)
    today = today or dt.datetime.now(dt.UTC).date()
    definitions: dict[str, InstrumentDefinition] = {}
    if directory.is_dir():
        for path in sorted(directory.glob("*.json")):
            if path.stem not in SHAPES:
                raise InstrumentConfigError(f"unexpected file {path.name}")
            definitions[path.stem] = load_definition(
                path, today=today, allow_synthetic=allow_synthetic
            )
    pending = tuple(code for code in SHAPES if code not in definitions)
    return InstrumentRegistry(definitions=definitions, pending=pending)
