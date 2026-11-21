"""An answer as the person gave it on screen, in their words and the app's.

Shared by the vignette runner (the report for the clinical lead) and the v2 API
(the answers shown back to the person in Z1, so they can correct one).
"""

from __future__ import annotations

from morpheo.funnel.artifact import SPANISH, Lang, StepDef
from morpheo.funnel.catalogue import duration_text
from morpheo.funnel.interview import NO, NO_LO_SE, PREFIERO, YES, Answer


def answer_label(answer: Answer, definition: StepDef, kind: str, lang: Lang = SPANISH) -> str:
    """The answer as the person gave it on screen, in the interview's language."""
    if answer.value is None:
        absence = {NO_LO_SE: lang.unknown, PREFIERO: lang.prefer}
        label = absence.get(answer.absence or "", "—")
        return label + (f" «{answer.text}»" if answer.text else "")
    value = answer.value
    if kind == "info":
        return lang.read
    if kind == "confirm":
        return {"sigue_igual": lang.same, "ha_cambiado": lang.changed}.get(value, str(value))
    if definition.type == "free_text":
        return f"«{answer.text or value}»"
    yes_no = {YES: lang.yes, NO: lang.no}
    if isinstance(value, str) and value in yes_no:
        note = f" «{answer.text}»" if answer.text else ""
        return yes_no[value] + note
    options = (*definition.options, *definition.retired_options, *definition.fields)
    labels = {o.key: o.label for o in options}
    if definition.type == "multi":
        chosen = [labels.get(str(k), str(k)) for k in value] if isinstance(value, list) else []
        return ", ".join(chosen) or lang.none_of_these
    if definition.type == "single":
        return labels.get(value, lang.none_of_these)
    if isinstance(value, dict) and "unit" in value:
        return duration_text(value, lang) or ""
    if isinstance(value, dict):
        return " · ".join(f"{labels.get(k, k)}: {v}" for k, v in value.items())
    if isinstance(value, int) and definition.unit:
        return f"{value} {definition.unit}"
    return str(value)
