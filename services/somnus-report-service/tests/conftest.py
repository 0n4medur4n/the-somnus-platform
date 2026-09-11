"""Shared report-render fixtures (build plan §20 Checkpoint 11.1).

`content` is a representative slice of Morpheo's approved (es) wording — the
report lays it out but never authors it. `make_request` builds a render request
for any locale/level/routes so the golden tests can exercise the matrix.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import datetime

import pytest

from report.application.content_review import (
    STATUS_APPROVED,
    STATUS_PENDING,
    ContentReviewItem,
    ContentReviewService,
)
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
        # Which safety rules fired. The by-id citation path (Checkpoint 11.3
        # Stage 4) resolves from these; empty means no rule fired, which is the
        # ordinary case for a plain L4 and the only case that still falls back
        # to similarity.
        triggered_rules: tuple[str, ...] = (),
    ) -> ReportRenderRequestDTO:
        return ReportRenderRequestDTO(
            assessment_id="assess-123",
            definition_version="1.0",
            content_version="1.2",
            locale=locale,
            role=role,
            level=level,
            stop=stop,
            triggered_rules=list(triggered_rules),
            routes=list(routes),
            completed_at="2026-08-17T12:00:00Z",
        )

    return build


class InMemoryContentReviewRepository:
    """The content-review persistence port, in memory (Checkpoint 15.3).

    Lives in conftest rather than in one test module so the queue tests and the
    render-gate tests exercise the same port implementation. The SQL one is
    covered against a real MySQL in tests/integration/test_content_review_db.py.
    """

    def __init__(self) -> None:
        self.items: dict[str, ContentReviewItem] = {}

    def add(self, item: ContentReviewItem) -> None:
        self.items[item.item_id] = item

    def get(self, item_id: str) -> ContentReviewItem | None:
        return self.items.get(item_id)

    def list_by_status(self, status: str, *, limit: int) -> Sequence[ContentReviewItem]:
        found = [item for item in self.items.values() if item.status == status]
        return sorted(found, key=lambda item: item.created_at)[:limit]

    def latest_approved_for_report(self, report_id: str) -> ContentReviewItem | None:
        found = [
            item
            for item in self.items.values()
            if item.report_id == report_id and item.status == STATUS_APPROVED
        ]
        return found[-1] if found else None

    def record_decision(
        self, item_id: str, *, status: str, reviewer_id: str, reason: str, decided_at: datetime
    ) -> ContentReviewItem | None:
        existing = self.items.get(item_id)
        # Mirrors the SQL WHERE clause: an already-decided row matches nothing,
        # which is what makes reviewer identity and timestamp immutable.
        if existing is None or existing.status != STATUS_PENDING:
            return None
        decided = replace(
            existing,
            status=status,
            reviewer_id=reviewer_id,
            decided_at=decided_at,
            reason=reason,
        )
        self.items[item_id] = decided
        return decided


@pytest.fixture
def make_review_service() -> Callable[[], ContentReviewService]:
    """A fresh, empty review service per call."""

    def _make() -> ContentReviewService:
        return ContentReviewService(InMemoryContentReviewRepository())

    return _make
