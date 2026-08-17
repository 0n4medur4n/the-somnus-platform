"""The report's own LAYOUT strings, localized (build plan §5.6, es/en/ca/fr).

These are presentation chrome (section headings, the "with the information
available" framing, the fixed limits statement) — NOT clinical content: the
clinical wording (level action, module output) is Morpheo's approved content,
laid out into the slots. Kept as JSON locale files (like the SPA); es is the
reference and every locale must carry the same keys.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

from report.schemas.render import Locale

_LOCALES_DIR = Path(__file__).parent / "locales"


@cache
def strings_for(locale: Locale) -> dict[str, str]:
    data: dict[str, str] = json.loads((_LOCALES_DIR / f"{locale}.json").read_text(encoding="utf-8"))
    return data
