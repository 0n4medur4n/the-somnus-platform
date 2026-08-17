"""Deterministic rendering behavior (build plan §20 Checkpoint 11.1)."""

from __future__ import annotations

from collections.abc import Callable

from report.rendering.renderer import TEMPLATE_VERSION, render_html
from report.schemas.render import (
    ClinicalContentDTO,
    ModuleContentDTO,
    OutputContractContentDTO,
    ReportRenderRequestDTO,
    SafetyLevelContentDTO,
)

RequestBuilder = Callable[..., ReportRenderRequestDTO]


def test_render_is_deterministic(content: ClinicalContentDTO, make_request: RequestBuilder) -> None:
    first = render_html(make_request(), content)
    second = render_html(make_request(), content)
    assert first.html == second.html  # byte-identical for identical input


def test_versions_are_stamped_in_the_output(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    result = render_html(make_request(level="L4"), content)
    assert result.template_version == TEMPLATE_VERSION
    for stamp in (TEMPLATE_VERSION, "1.0", "1.1", "assess-123", "2026-08-17T12:00:00Z"):
        assert stamp in result.html


def test_l4_shows_the_with_information_available_framing(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    html = render_html(make_request(level="L4"), content).html
    assert "Con la información disponible" in html
    assert "Información y observación" in html


def test_emergency_shows_no_reassuring_hypothesis(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    html = render_html(make_request(level="L0", routes=(), stop=True), content).html
    assert "Emergencia actual" in html
    assert "no se ofrecen hipótesis" in html
    # An emergency shows no summary or pattern sections.
    assert 'class="summary"' not in html
    assert 'class="patterns"' not in html


def test_clinical_content_is_html_escaped(make_request: RequestBuilder) -> None:
    hostile = ClinicalContentDTO(
        locale="es",
        content_version="1.1",
        modules=[
            ModuleContentDTO(
                id="INS", name="X", minimum_questions=[], output="<script>alert(1)</script>"
            )
        ],
        safety_levels=[SafetyLevelContentDTO(id="L4", name="Info", action="A")],
        output_contract=OutputContractContentDTO(
            patient_parent=[], professional=[], forbidden_phrases=[]
        ),
    )
    html = render_html(make_request(level="L4", routes=("INS",)), hostile).html
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html
