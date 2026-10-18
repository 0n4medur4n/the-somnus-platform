"""SYNTHETIC instrument files for tests only.

These are NOT the validated instruments: every text is a marked placeholder and
the bands are arbitrary splits, not the published cut-offs. They only have the
shape of the real files (item count, response values), which is all the tests
need. The licensed files never enter the repository.
"""

from __future__ import annotations

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
        "licence": {
            "licensor": f"{MARK} licenciante",
            "reference": "TEST-0",
            "valid_until": "2099-12-31",
        },
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


def write(directory: Path, code: str, raw: dict[str, Any] | None = None) -> Path:
    path = directory / f"{code}.json"
    path.write_text(json.dumps(raw or synthetic(code), ensure_ascii=False), encoding="utf-8")
    return path
