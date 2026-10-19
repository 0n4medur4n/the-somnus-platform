"""An answer as the person gave it on screen, in their words and the app's.

Shared by the vignette runner (the report for the clinical lead) and the v2 API
(the answers shown back to the person in Z1, so they can correct one).
"""

from __future__ import annotations

from morpheo.funnel.artifact import StepDef
from morpheo.funnel.catalogue import duration_text
from morpheo.funnel.interview import NO, NO_LO_SE, PREFIERO, YES, Answer

_ABSENCE = {NO_LO_SE: "No lo sé", PREFIERO: "Prefiero no responder"}
_CONFIRM = {"sigue_igual": "Sigue igual", "ha_cambiado": "Ha cambiado"}
_YES_NO = {YES: "Sí", NO: "No"}
_NONE_OF_THESE = "Ninguna de estas"


def answer_label(answer: Answer, definition: StepDef, kind: str) -> str:
    """The answer as the person gave it on screen, in their language."""
    if answer.value is None:
        label = _ABSENCE.get(answer.absence or "", "—")
        return label + (f" «{answer.text}»" if answer.text else "")
    value = answer.value
    if kind == "info":
        return "Leído"
    if kind == "confirm":
        return _CONFIRM.get(value, str(value))
    if definition.type == "free_text":
        return f"«{answer.text or value}»"
    if isinstance(value, str) and value in _YES_NO:
        note = f" «{answer.text}»" if answer.text else ""
        return _YES_NO[value] + note
    labels = {o.key: o.label for o in (*definition.options, *definition.fields)}
    if definition.type == "multi":
        chosen = [labels.get(str(k), str(k)) for k in value] if isinstance(value, list) else []
        return ", ".join(chosen) or _NONE_OF_THESE
    if definition.type == "single":
        return labels.get(value, _NONE_OF_THESE)
    if isinstance(value, dict) and "unit" in value:
        return duration_text(value) or ""
    if isinstance(value, dict):
        return " · ".join(f"{labels.get(k, k)}: {v}" for k, v in value.items())
    if isinstance(value, int) and definition.unit:
        return f"{value} {definition.unit}"
    return str(value)
