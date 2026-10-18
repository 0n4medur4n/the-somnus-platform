"""Instrument files: off by default, fail closed, never in the repository."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

import pytest

from morpheo.instruments.definitions import (
    SHAPES,
    InstrumentConfigError,
    load_registry,
    parse_definition,
)
from morpheo.settings.config import Settings

from .synthetic import MARK, synthetic, write

TODAY = dt.date(2026, 10, 18)
SERVICE_ROOT = Path(__file__).resolve().parents[3]


def _settings(**values: Any) -> Settings:
    return Settings(_env_file=None, **values)


def _parse(raw: dict[str, Any], **kwargs: Any) -> Any:
    return parse_definition(raw, "0" * 64, today=TODAY, allow_synthetic=True, **kwargs)


def test_the_switch_is_off_by_default_and_nothing_is_read() -> None:
    registry = load_registry(_settings(instruments_source_dir="/does/not/exist"))
    assert registry.enabled is False
    assert registry.definitions == {}


def test_on_without_a_directory_fails_closed() -> None:
    with pytest.raises(InstrumentConfigError, match="needs INSTRUMENTS_SOURCE_DIR"):
        load_registry(_settings(instruments_enabled=True))


def test_on_with_no_files_fails_closed(tmp_path: Path) -> None:
    settings = _settings(instruments_enabled=True, instruments_source_dir=str(tmp_path))
    with pytest.raises(InstrumentConfigError, match="no licensed file"):
        load_registry(settings, today=TODAY)


def test_licences_may_arrive_one_at_a_time(tmp_path: Path) -> None:
    write(tmp_path, "ISI")
    write(tmp_path, "ESS")
    settings = _settings(instruments_enabled=True, instruments_source_dir=str(tmp_path))
    registry = load_registry(settings, today=TODAY, allow_synthetic=True)
    assert sorted(registry.definitions) == ["ESS", "ISI"]
    isi = registry.definitions["ISI"]
    assert len(isi.items) == 7 and len(isi.source_sha256) == 64


def test_a_synthetic_file_is_refused_outside_tests(tmp_path: Path) -> None:
    write(tmp_path, "ISI")
    settings = _settings(instruments_enabled=True, instruments_source_dir=str(tmp_path))
    with pytest.raises(InstrumentConfigError, match="synthetic test file"):
        load_registry(settings, today=TODAY)


def test_synthetic_text_in_a_file_claiming_to_be_licensed_is_refused() -> None:
    with pytest.raises(InstrumentConfigError, match="synthetic text"):
        parse_definition(synthetic("ESS", synthetic=False), "0" * 64, today=TODAY)


def test_an_expired_licence_is_refused() -> None:
    raw = synthetic("ISI")
    raw["licence"]["valid_until"] = "2026-10-17"
    with pytest.raises(InstrumentConfigError, match="licence expired"):
        _parse(raw)


@pytest.mark.parametrize("code", sorted(SHAPES))
def test_a_missing_item_is_refused(code: str) -> None:
    raw = synthetic(code)
    raw["items"] = raw["items"][:-1]
    with pytest.raises(InstrumentConfigError, match="items, expected"):
        _parse(raw)


def test_wrong_response_values_are_refused() -> None:
    raw = synthetic("STOP-BANG")
    raw["items"][0]["options"].append({"value": 2, "label": f"{MARK} de más"})
    with pytest.raises(InstrumentConfigError, match="response values"):
        _parse(raw)


def test_bands_with_a_gap_are_refused() -> None:
    raw = synthetic("ISI")
    raw["scoring"]["bands"][1]["min"] += 1
    with pytest.raises(InstrumentConfigError, match="without gaps"):
        _parse(raw)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("instrument", "PSQI", "unknown instrument"),
        ("language", "es-MX", "language"),
        ("instructions", "  ", "empty text"),
    ],
)
def test_other_malformed_files_are_refused(field: str, value: str, message: str) -> None:
    with pytest.raises(InstrumentConfigError, match=message):
        _parse(synthetic("ESS", **{field: value}))


def test_a_file_named_for_another_instrument_is_refused(tmp_path: Path) -> None:
    write(tmp_path, "ISI", synthetic("ESS"))
    settings = _settings(instruments_enabled=True, instruments_source_dir=str(tmp_path))
    with pytest.raises(InstrumentConfigError, match="holds ESS"):
        load_registry(settings, today=TODAY, allow_synthetic=True)


def test_broken_json_is_a_configuration_error(tmp_path: Path) -> None:
    (tmp_path / "ISI.json").write_text("{", encoding="utf-8")
    settings = _settings(instruments_enabled=True, instruments_source_dir=str(tmp_path))
    with pytest.raises(InstrumentConfigError, match="not valid UTF-8 JSON"):
        load_registry(settings, today=TODAY)


def test_no_instrument_file_is_committed_to_the_service() -> None:
    # The validated items are licensed: they are mounted at runtime, never
    # committed, and never copied into the image with clinical/.
    for path in SERVICE_ROOT.rglob("*.json"):
        if ".venv" in path.parts or "node_modules" in path.parts:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        assert not (isinstance(data, dict) and data.get("instrument") in SHAPES), path
