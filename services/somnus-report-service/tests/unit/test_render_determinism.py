"""The determinism proof (build plan §20 Checkpoint 11.3 Stage 4 exit criterion).

The same assessment produces the identical L-level and routes whether retrieval
returns correct results, wrong results, or nothing at all. Retrieval attaches
citations to a decision the deterministic engine already made; it can never change
the level, the routing, or any other content.
"""

from __future__ import annotations

import re
from collections.abc import Callable

from report.rendering.renderer import render_html
from report.schemas.render import ClinicalContentDTO, ReportRenderRequestDTO
from report.schemas.retrieval import RetrievedSource

RequestBuilder = Callable[..., ReportRenderRequestDTO]

_SOURCES_SECTION = re.compile(r'\s*<section class="sources">.*?</section>', re.DOTALL)


def _without_citations(html: str) -> str:
    """The decision-bearing HTML — everything except the citations section."""
    return _SOURCES_SECTION.sub("", html)


def test_retrieval_never_changes_the_level_or_routes(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    request = make_request(level="L4", routes=("INS", "SLP"))

    correct = render_html(
        request, content, citations=[RetrievedSource("SRC-01", "Cita correcta.", "u", 0.9)]
    )
    wrong = render_html(
        request, content, citations=[RetrievedSource("SRC-15", "Cita irrelevante.", "u", 0.02)]
    )
    empty = render_html(request, content, citations=[])
    default = render_html(request, content)

    # Whatever retrieval returns — right, wrong, empty, or nothing — the
    # decision-bearing HTML (level + routed modules + everything else) is IDENTICAL.
    decision_html = {_without_citations(report.html) for report in (correct, wrong, empty, default)}
    assert len(decision_html) == 1

    # Citations only ever appear inside their own section.
    assert "Cita correcta." in correct.html
    assert "Cita irrelevante." in wrong.html
    assert 'class="sources"' not in empty.html
    assert 'class="sources"' not in default.html


def test_emergency_output_never_shows_citations(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    # Even if a citation is somehow supplied, an L0 emergency report shows only the
    # emergency notice — grounding belongs to the professional (non-emergency) path.
    request = make_request(level="L0", routes=("INS",))
    html = render_html(
        request, content, citations=[RetrievedSource("SRC-01", "Cita.", "u", 0.9)]
    ).html
    assert 'class="sources"' not in html
    assert "Cita." not in html
