"""Deterministic rendering behavior (build plan §20 Checkpoint 11.1)."""

from __future__ import annotations

from collections.abc import Callable

import pytest

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
    for stamp in (TEMPLATE_VERSION, "1.0", "1.2", "assess-123", "2026-08-17T12:00:00Z"):
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


def test_emergency_still_stamps_every_version(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    # Removing the normal sections must NOT drop the version/immutability stamp:
    # the meta header is rendered for every level, including L0.
    html = render_html(make_request(level="L0", routes=(), stop=True), content).html
    for stamp in (TEMPLATE_VERSION, "1.0", "1.2", "assess-123", "2026-08-17T12:00:00Z"):
        assert stamp in html


@pytest.mark.parametrize("level", [None, "L1", "L2", "L3", "L4"])
def test_emergency_notice_never_triggers_below_l0(
    level: str | None, content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    # Clinical governance: the emergency notice is triggered EXCLUSIVELY by
    # Morpheo's structured level == "L0". Even with stop=True and every route,
    # no other field may surface it.
    html = render_html(make_request(level=level, stop=True, routes=("INS", "SLP")), content).html
    assert "care-level emergency" not in html
    assert 'role="alert"' not in html
    assert "no se ofrecen hipótesis" not in html


def test_emergency_notice_triggers_only_on_l0(
    content: ClinicalContentDTO, make_request: RequestBuilder
) -> None:
    # ...and L0 shows it even with stop=False and routes present: the trigger is
    # the level alone, not `stop` or any other signal.
    html = render_html(make_request(level="L0", stop=False, routes=("INS",)), content).html
    assert "care-level emergency" in html
    assert 'role="alert"' in html


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
        limits_text=["Información general y preguntas para comentar con tu profesional."],
        output_contract=OutputContractContentDTO(
            patient_parent=[], professional=[], forbidden_phrases=[]
        ),
    )
    html = render_html(make_request(level="L4", routes=("INS",)), hostile).html
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html
