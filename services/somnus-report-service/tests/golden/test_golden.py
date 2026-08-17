"""Golden-file tests per template version and locale (build plan §20 11.1).

The rendered HTML is compared byte-for-byte against a checked-in golden. A
deliberate template/wording change regenerates the goldens (reviewed):
    REPORT_UPDATE_GOLDEN=1 uv run pytest tests/golden
"""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path

import pytest

from report.rendering.renderer import render_html
from report.schemas.render import ClinicalContentDTO, ReportRenderRequestDTO

RequestBuilder = Callable[..., ReportRenderRequestDTO]
GOLDEN_DIR = Path(__file__).parent / "files"
_UPDATE = os.environ.get("REPORT_UPDATE_GOLDEN") == "1"


def _check(name: str, html: str) -> None:
    path = GOLDEN_DIR / f"{name}.html"
    if _UPDATE or not path.exists():
        GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
        # Store LF so goldens are stable across OSes (read below is newline-agnostic).
        path.write_text(html, encoding="utf-8", newline="\n")
    expected = path.read_text(encoding="utf-8")
    assert html == expected, (
        f"golden mismatch for {name}; after reviewing, regenerate with REPORT_UPDATE_GOLDEN=1"
    )


@pytest.mark.parametrize("locale", ["es", "en", "ca", "fr"])
def test_golden_report_per_locale(
    locale: str, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    html = render_html(make_request(locale=locale, level="L4", routes=("INS", "SLP")), content).html
    _check(f"report_v1_{locale}", html)


def test_golden_emergency_report(content: ClinicalContentDTO, make_request: RequestBuilder) -> None:
    html = render_html(make_request(locale="es", level="L0", routes=(), stop=True), content).html
    _check("report_v1_es_emergency", html)
