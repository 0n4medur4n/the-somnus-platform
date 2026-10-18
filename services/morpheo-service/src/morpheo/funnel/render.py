"""The final text: v0.2 templates (pp. 11-12), filled with confirmed answers.

No model writes here. Each [placeholder] takes the person's confirmed answer or
a literal fragment of the v0.2 question it came from (D-32). Where v0.2 has no
text for a case, the output carries the artifact's `pending_texts` marker
("PENDIENTE", for the clinical lead to write) instead of inventing one.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

from morpheo.funnel.artifact import FunnelArtifact
from morpheo.funnel.interview import YES, Interview

if TYPE_CHECKING:
    from morpheo.funnel.rules import Orientation

_UNITS = {
    "dias": ("día", "días"),
    "semanas": ("semana", "semanas"),
    "meses": ("mes", "meses"),
    "años": ("año", "años"),
    "horas": ("hora", "horas"),
}


def _strip(text: str) -> str:
    """The template without its surrounding «», keeping its final period."""
    text = text.strip().removeprefix("«")
    for closing, end in (("».", "."), ("»", "")):
        if text.endswith(closing):
            return text[: -len(closing)] + end
    return text


def _lower_first(text: str) -> str:
    return text[:1].lower() + text[1:] if text else text


def _question(text: str) -> str:
    return text.strip().strip("¿?").strip()


def _duration(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    singular, plural = _UNITS.get(value["unit"], (value["unit"], value["unit"]))
    amount = value["value"]
    return f"{amount} {singular if amount == 1 else plural}"


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " y " + items[-1]


def _fill(text: str, placeholder: str, value: str | None) -> str:
    return text.replace(f"[{placeholder}]", value if value else f"[{placeholder}: sin dato]")


def _labels(iv: Interview, step_id: str) -> list[str]:
    chosen = iv.value(step_id)
    definition = iv._first(step_id)
    if definition is None or not isinstance(chosen, list):
        return []
    by_key = {o.key: o.label for o in definition.options}
    return [by_key[k] for k in chosen if k in by_key]


def _yes_fragments(iv: Interview, *step_ids: str) -> list[str]:
    """The literal text of each question answered "Sí" -- explicitly, not
    inferred from an earlier answer (that one is already counted)."""
    out = []
    for step_id in step_ids:
        definition = iv._first(step_id)
        given = iv.answer(step_id)
        if definition is not None and given is not None and given.value == YES:
            out.append(_question(definition.text))
    return out


def _breathing_signs(iv: Interview) -> str | None:
    signs = _labels(iv, "Q15") + _yes_fragments(iv, "R1", "R2a", "R2b", "R2c")
    if not signs:
        return None
    text = _join([_lower_first(sign) for sign in dict.fromkeys(signs)])
    return text[0].upper() + text[1:]


def _psg_reason(iv: Interview) -> str | None:
    reasons = _labels(iv, "R4") + _yes_fragments(iv, "R6", "D2a", "D2b") + _labels(iv, "N2")
    return _join([_lower_first(reason) for reason in reasons]) if reasons else None


def _safety_action(artifact: FunnelArtifact, why: str) -> str:
    question = why.split(" ")[0]
    step = artifact.step(question, "end")
    action = step.outcomes.get("Sí", "")
    resources = artifact.engine["resources"]
    lines = [action.rstrip("."), f"Teléfono de emergencias: {resources['EMERGENCIA']}"]
    if question == "S4":
        lines.append(f"También: {resources['S4_extra']}")
    # The template puts the period after the placeholder.
    return ". ".join(line for line in lines if line)


def render(
    artifact: FunnelArtifact,
    orientations: Sequence[Orientation],
    iv: Interview,
    pending: Sequence[str],
) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    pending_texts = artifact.engine["pending_texts"]
    templates = {o.template for o in orientations}
    for o in orientations:
        template = o.template
        if template is None:
            continue
        if template.startswith("PENDIENTE:"):
            out.append((template, f"{pending_texts[template.split(':')[1]]} ({o.why})"))
            continue
        text = _strip(artifact.templates[template])
        if template == "T_SEGURIDAD":
            text = _fill(text, "Acción concreta según S1-S4", _safety_action(artifact, o.why))
        elif template == "T_SOMNOLENCIA" and iv.safety("S2") == YES:
            out.append(("S2_aviso", pending_texts["S2_driver_warning"]))
        elif template == "T_INSOMNIO":
            text = _fill(
                text, "dificultad", _join(_labels(iv, "Q08")) if _labels(iv, "Q08") else None
            )
            q05 = iv.value("Q05")
            text = _fill(
                text, "frecuencia", f"{q05} noches por semana" if isinstance(q05, int) else None
            )
            text = _fill(text, "duración", _duration(iv.value("Q03")))
            q10 = iv.answer("Q10")
            text = _fill(text, "impacto", _lower_first(q10.text) if q10 and q10.text else None)
            others = templates - {"T_INSOMNIO", "T_HABITOS", "T_HORARIO"}
            if not others:
                text = f"{text} {artifact.templates['T_INSOMNIO.sin_otras_senales']}."
        elif template in ("T_RESPIRACION",):
            text = _fill(text, "Pausas/ahogos/otras señales confirmadas", _breathing_signs(iv))
        elif template == "T_COMBINADO":
            signs = _breathing_signs(iv)
            text = _fill(
                text, "señal respiratoria", signs[0].lower() + signs[1:] if signs else None
            )
        elif template == "T_PSG":
            text = _fill(text, "motivo concreto", _psg_reason(iv))
        elif template == "T_INCOMPLETO":
            first = pending[0] if pending else None
            if first in ("S1", "S2", "S3", "S4"):
                first = "«" + artifact.step(first, "end").text + "»"
            text = _fill(text, "dato", first)
        elif template == "T_HABITOS":
            choice = iv.answer("T_HABITOS.cambio")
            text = _fill(text, "cambio elegido", choice.text if choice else None)
        out.append((template, text))
    return out
