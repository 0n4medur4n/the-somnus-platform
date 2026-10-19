"""SYNTHETIC instrument files for tests only.

These are NOT the validated instruments: every text is a marked placeholder and
the bands are arbitrary splits, not the published cut-offs. They only have the
shape of the official files (item count, response values, an official text with
its SHA-256 beside the JSON), which is all the tests need.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from morpheo.instruments.definitions import SHAPES

MARK = "[SINTÉTICO]"


def synthetic(code: str, **overrides: Any) -> dict[str, Any]:
    shape = SHAPES[code]
    values = sorted(shape.values)
    high = max(values) * shape.items
    raw: dict[str, Any] = {
        "instrument": code,
        "name": f"{MARK} {code}",
        "language": "es-ES",
        "version": "test-0",
        "synthetic": True,
        "licence": {"source": f"{MARK} licenciante", "reference": "TEST-0", "valid_until": None},
        "official_text": {"file": f"{code}.official.txt", "sha256": ""},
        "instructions": f"{MARK} Instrucciones de prueba; no es el texto validado.",
        "items": [
            {
                "id": f"i{n}",
                "text": f"{MARK} Ítem {n} de prueba; no es el texto validado.",
                "options": [{"value": v, "label": f"{MARK} opción {v}"} for v in values],
            }
            for n in range(1, shape.items + 1)
        ],
        "scoring": {
            "method": "sum",
            "bands": [
                {"min": 0, "max": high // 2, "label": f"{MARK} banda baja"},
                {"min": high // 2 + 1, "max": high, "label": f"{MARK} banda alta"},
            ],
        },
    }
    raw.update(overrides)
    return raw


def official_text(raw: dict[str, Any]) -> str:
    """The 'official' text the synthetic file is transcribed from: every string
    it shows, one per line, as a licensor's document would carry them."""
    lines = [raw["instructions"]]
    for item in raw["items"]:
        lines.append(item["text"])
        lines.extend(option["label"] for option in item["options"])
    lines.extend(band["label"] for band in raw["scoring"]["bands"])
    return "\n".join(dict.fromkeys(lines)) + "\n"


def write(directory: Path, code: str, raw: dict[str, Any] | None = None) -> Path:
    raw = raw or synthetic(code)
    text = official_text(raw).encode("utf-8")
    text_name = raw["official_text"]["file"]
    (directory / text_name).write_bytes(text)
    if not raw["official_text"]["sha256"]:
        raw = {
            **raw,
            "official_text": {"file": text_name, "sha256": hashlib.sha256(text).hexdigest()},
        }
    path = directory / f"{code}.json"
    path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    return path


def sha256_of(raw: dict[str, Any]) -> str:
    return hashlib.sha256(official_text(raw).encode("utf-8")).hexdigest()
