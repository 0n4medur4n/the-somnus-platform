"""Shared report-render fixtures (build plan §20 Checkpoint 11.1).

`content` is a representative slice of Morpheo's approved (es) wording — the
report lays it out but never authors it. `make_request` builds a render request
for any locale/level/routes so the golden tests can exercise the matrix.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from report.schemas.render import (
    ClinicalContentDTO,
    Locale,
    ModuleContentDTO,
    OutputContractContentDTO,
    ReportRenderRequestDTO,
    SafetyLevel,
    SafetyLevelContentDTO,
)

RequestBuilder = Callable[..., ReportRenderRequestDTO]


def _content() -> ClinicalContentDTO:
    return ClinicalContentDTO(
        locale="es",
        content_version="1.1",
        modules=[
            ModuleContentDTO(
                id="INS",
                name="Dificultad para dormir",
                minimum_questions=["¿Desde cuándo?", "¿Cuántas noches por semana?"],
                output="Has comunicado un patrón de dificultad para dormir.",
            ),
            ModuleContentDTO(
                id="SLP",
                name="Somnolencia diurna",
                minimum_questions=["¿Se duerme en actividades cotidianas?"],
                output="Has comunicado somnolencia diurna que conviene valorar.",
            ),
        ],
        safety_levels=[
            SafetyLevelContentDTO(
                id="L0",
                name="Emergencia actual",
                action="Busca atención de emergencia local ahora.",
            ),
            SafetyLevelContentDTO(
                id="L1",
                name="Valoración urgente / mismo día",
                action="No conduzcas ni realices tareas de riesgo; busca valoración hoy.",
            ),
            SafetyLevelContentDTO(
                id="L4",
                name="Información y observación",
                action="Educación general y observación limitada.",
            ),
        ],
        limits_text=[
            "Morpheo organiza los síntomas y propone qué conviene valorar con un profesional.",
            (
                "Un resultado orientativo bajo no descarta un trastorno; "
                "consulta si los síntomas persisten o preocupan."
            ),
            "Información general y preguntas para comentar con tu profesional.",
        ],
        blocked_claims=[
            "Morpheo sustituye una consulta médica o pediátrica.",
            "Morpheo diagnostica insomnio, apnea, narcolepsia u otros trastornos del sueño.",
        ],
        output_contract=OutputContractContentDTO(
            patient_parent=["Resumen."],
            professional=["Resumen."],
            forbidden_phrases=["Tienes [diagnóstico].", "No tienes [enfermedad]."],
        ),
    )


@pytest.fixture
def content() -> ClinicalContentDTO:
    return _content()


@pytest.fixture
def make_request() -> RequestBuilder:
    def build(
        *,
        locale: Locale = "es",
        level: SafetyLevel | None = "L4",
        routes: tuple[str, ...] = ("INS",),
        stop: bool = False,
        role: str = "adult",
    ) -> ReportRenderRequestDTO:
        return ReportRenderRequestDTO(
            assessment_id="assess-123",
            definition_version="1.0",
            content_version="1.2",
            locale=locale,
            role=role,
            level=level,
            stop=stop,
            triggered_rules=[],
            routes=list(routes),
            completed_at="2026-08-17T12:00:00Z",
        )

    return build
