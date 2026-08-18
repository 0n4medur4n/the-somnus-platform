"""Mapping Morpheo's content to the report's subset (build plan §5.5 / §5.6)."""

from __future__ import annotations

from report.infrastructure.morpheo_client import _to_content


def test_maps_morpheo_content_to_the_report_subset() -> None:
    raw = {
        "locale": "es",
        "workflowVersion": "1.0",
        "contentVersion": "1.2",
        "modules": [
            {
                "id": "INS",
                "name": "Dificultad para dormir",
                "entry": ["despertares"],
                "minimumQuestions": ["¿Desde cuándo?"],
                "output": "Has comunicado dificultad para dormir.",
            }
        ],
        "safetyLevels": [{"id": "L4", "name": "Información", "action": "Observa."}],
        "safetyPrompts": [{"signalId": "cyanosis", "context": "general", "question": "¿Azulado?"}],
        "limitsText": ["Límite uno.", "Límite dos.", "Límite tres."],
        "blockedClaims": ["Morpheo sustituye una consulta."],
        "outputContract": {
            "patientParent": ["Resumen."],
            "professional": ["Resumen."],
            "forbiddenPhrases": ["Tienes [x]."],
        },
    }
    content = _to_content(raw)

    assert content.content_version == "1.2"
    # entry + safetyPrompts are dropped; the report only lays out what it needs.
    assert content.modules[0].id == "INS"
    assert content.modules[0].output == "Has comunicado dificultad para dormir."
    assert content.safety_levels[0].id == "L4"
    assert content.limits_text == ["Límite uno.", "Límite dos.", "Límite tres."]
