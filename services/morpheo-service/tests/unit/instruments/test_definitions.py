"""Official instrument files: verified word for word, pending until they arrive."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

import pytest

from morpheo.instruments.definitions import (
    INSTRUMENTS_DIR,
    SHAPES,
    InstrumentConfigError,
    load_registry,
    parse_definition,
)
from morpheo.settings.config import Settings

from .synthetic import MARK, official_text, sha256_of, synthetic, write

TODAY = dt.date(2026, 10, 19)


def _settings(**values: Any) -> Settings:
    return Settings(_env_file=None, **values)


def _parse(raw: dict[str, Any], text: str | None = None) -> Any:
    raw = {**raw, "official_text": {"file": "x.txt", "sha256": sha256_of(raw)}}
    return parse_definition(
        raw,
        official_text(raw) if text is None else text,
        sha256_of(raw),
        today=TODAY,
        allow_synthetic=True,
    )


def test_off_reads_nothing_and_offers_nothing() -> None:
    registry = load_registry(_settings(instruments_enabled=False, instruments_source_dir="/nope"))
    assert registry.enabled is False
    assert registry.definitions == {} and registry.pending == ()


def test_on_without_files_every_instrument_is_pending(tmp_path: Path) -> None:
    registry = load_registry(_settings(instruments_source_dir=str(tmp_path)), today=TODAY)
    assert registry.enabled is True
    assert registry.definitions == {}
    assert registry.pending == ("ISI", "ESS", "STOP-BANG")


def test_files_load_and_the_rest_stay_pending(tmp_path: Path) -> None:
    write(tmp_path, "ISI")
    settings = _settings(instruments_source_dir=str(tmp_path))
    registry = load_registry(settings, today=TODAY, allow_synthetic=True)
    assert list(registry.definitions) == ["ISI"]
    assert registry.pending == ("ESS", "STOP-BANG")
    isi = registry.definitions["ISI"]
    assert len(isi.items) == 7 and len(isi.official_sha256) == 64


def test_the_repository_has_no_official_file_yet() -> None:
    # Until Jesús delivers them, the clinical artifacts hold no instrument; a
    # file that does arrive must load (this test then changes with it).
    registry = load_registry(_settings(), today=TODAY)
    assert registry.pending == ("ISI", "ESS", "STOP-BANG")
    assert not INSTRUMENTS_DIR.is_dir() or not list(INSTRUMENTS_DIR.glob("*.json"))


def test_a_reworded_item_is_refused() -> None:
    raw = synthetic("ISI")
    text = official_text(raw)
    raw["items"][2]["text"] = f"{MARK} Ítem 3 reformulado."
    with pytest.raises(InstrumentConfigError, match="not word for word"):
        _parse(raw, text)


def test_a_reworded_option_or_band_is_refused() -> None:
    raw = synthetic("ESS")
    text = official_text(raw)
    raw["items"][0]["options"][1]["label"] = f"{MARK} otra opción"
    with pytest.raises(InstrumentConfigError, match="not word for word"):
        _parse(raw, text)
    raw = synthetic("ESS")
    text = official_text(raw)
    raw["scoring"]["bands"][0]["label"] = f"{MARK} otra banda"
    with pytest.raises(InstrumentConfigError, match="not word for word"):
        _parse(raw, text)


def test_line_breaks_in_the_official_text_are_not_a_change_of_wording() -> None:
    raw = synthetic("ISI")
    text = official_text(raw).replace("Instrucciones de prueba;", "Instrucciones\nde prueba;")
    assert _parse(raw, text).code == "ISI"


def test_an_official_text_that_does_not_match_its_sha256_is_refused(tmp_path: Path) -> None:
    path = write(tmp_path, "ESS")
    (tmp_path / "ESS.official.txt").write_text("otro texto\n", encoding="utf-8")
    settings = _settings(instruments_source_dir=str(tmp_path))
    with pytest.raises(InstrumentConfigError, match="SHA-256"):
        load_registry(settings, today=TODAY, allow_synthetic=True)
    assert path.exists()


def test_a_missing_official_text_is_refused(tmp_path: Path) -> None:
    write(tmp_path, "ISI")
    (tmp_path / "ISI.official.txt").unlink()
    settings = _settings(instruments_source_dir=str(tmp_path))
    with pytest.raises(InstrumentConfigError, match=r"official text ISI.official.txt is missing"):
        load_registry(settings, today=TODAY, allow_synthetic=True)


def test_a_synthetic_file_is_refused_outside_tests(tmp_path: Path) -> None:
    write(tmp_path, "ISI")
    with pytest.raises(InstrumentConfigError, match="synthetic test file"):
        load_registry(_settings(instruments_source_dir=str(tmp_path)), today=TODAY)


def test_synthetic_text_in_a_file_claiming_to_be_official_is_refused() -> None:
    raw = synthetic("ESS", synthetic=False)
    with pytest.raises(InstrumentConfigError, match="synthetic text"):
        parse_definition(
            {**raw, "official_text": {"file": "x", "sha256": sha256_of(raw)}},
            official_text(raw),
            sha256_of(raw),
            today=TODAY,
        )


def test_an_expired_licence_is_refused_and_no_expiry_is_allowed() -> None:
    raw = synthetic("ISI")
    raw["licence"]["valid_until"] = "2026-10-18"
    with pytest.raises(InstrumentConfigError, match="licence expired"):
        _parse(raw)
    raw["licence"]["valid_until"] = None
    assert _parse(raw).licence.valid_until is None


@pytest.mark.parametrize("code", sorted(SHAPES))
def test_a_missing_item_is_refused(code: str) -> None:
    raw = synthetic(code)
    raw["items"] = raw["items"][:-1]
    with pytest.raises(InstrumentConfigError, match="items, expected"):
        _parse(raw)


def test_wrong_response_values_are_refused() -> None:
    raw = synthetic("STOP-BANG")
    raw["items"][0]["options"].append({"value": 2, "label": f"{MARK} opción 1"})
    with pytest.raises(InstrumentConfigError, match="response values"):
        _parse(raw)


def test_bands_with_a_gap_are_refused() -> None:
    raw = synthetic("ISI")
    raw["scoring"]["bands"][1]["min"] += 1
    with pytest.raises(InstrumentConfigError, match="without gaps"):
        _parse(raw)


def test_a_band_override_must_name_known_items_and_bands() -> None:
    raw = synthetic("STOP-BANG")
    raw["scoring"]["band_overrides"] = [
        {"band": f"{MARK} banda alta", "subtotal": {"items": ["i1", "i9"], "min": 2}}
    ]
    with pytest.raises(InstrumentConfigError, match="unknown item"):
        _parse(raw)
    raw["scoring"]["band_overrides"] = [{"band": "otra", "any_of_items": ["i5"]}]
    with pytest.raises(InstrumentConfigError, match="unknown band"):
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
    raw = synthetic("ESS")
    write(tmp_path, "ESS", raw)
    (tmp_path / "ESS.json").rename(tmp_path / "ISI.json")
    with pytest.raises(InstrumentConfigError, match="holds ESS"):
        load_registry(
            _settings(instruments_source_dir=str(tmp_path)), today=TODAY, allow_synthetic=True
        )


def test_broken_json_is_a_configuration_error(tmp_path: Path) -> None:
    (tmp_path / "ISI.json").write_text("{", encoding="utf-8")
    with pytest.raises(InstrumentConfigError, match="not valid UTF-8 JSON"):
        load_registry(_settings(instruments_source_dir=str(tmp_path)), today=TODAY)


def test_an_unexpected_file_is_refused(tmp_path: Path) -> None:
    (tmp_path / "PSQI.json").write_text(json.dumps({}), encoding="utf-8")
    with pytest.raises(InstrumentConfigError, match="unexpected file"):
        load_registry(_settings(instruments_source_dir=str(tmp_path)), today=TODAY)
