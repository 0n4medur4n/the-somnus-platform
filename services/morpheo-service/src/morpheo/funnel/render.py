"""The final text: v0.2 templates (pp. 11-12), filled from the phrase catalogue.

No model writes here. Each [placeholder] takes phrases from the closed
catalogue (`morpheo.funnel.catalogue`), chosen by the confirmed answers; the
person's own words never enter a template. Where v0.2 has no text for a case,
the output carries the artifact's `pending_texts` marker ("PENDIENTE", for the
clinical lead to write) instead of inventing one.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING

from morpheo.funnel.artifact import FunnelArtifact, StepDef
from morpheo.funnel.catalogue import Catalogue, Selector, funnel_catalogue
from morpheo.funnel.interview import YES, Interview

if TYPE_CHECKING:
    from morpheo.funnel.rules import Orientation


def _strip(text: str) -> str:
    """The template without its surrounding «», keeping its final period."""
    text = text.strip().removeprefix("«")
    for closing, end in (("».", "."), ("»", "")):
        if text.endswith(closing):
            return text[: -len(closing)] + end
    return text


def _fill(text: str, placeholder: str, value: str | None) -> str:
    return text.replace(f"[{placeholder}]", value if value else f"[{placeholder}: sin dato]")


def _capitalise(text: str) -> str:
    return text[:1].upper() + text[1:]


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


def _fill_from_catalogue(text: str, template: str, selector: Selector) -> str:
    for name in selector.c.placeholders.get(template, {}):
        text = _fill(text, name, selector.placeholder(template, name))
    return text


def question_text(
    definition: StepDef, iv: Interview, catalogue: Catalogue | None = None
) -> tuple[str, list[str]]:
    """The question as the person sees it; Z1 carries the summary to confirm."""
    if definition.id != "Z1":
        return definition.text, []
    selector = Selector(catalogue or funnel_catalogue(), iv)
    return _fill_from_catalogue(definition.text, "Z1", selector), selector.used


def render(
    artifact: FunnelArtifact,
    orientations: Sequence[Orientation],
    iv: Interview,
    pending: Sequence[str],
    catalogue: Catalogue | None = None,
) -> tuple[list[tuple[str, str]], list[str]]:
    """The texts, in order, and the ids of the catalogue phrases they used."""
    selector = Selector(catalogue or funnel_catalogue(), iv, pending)
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
            text = _fill_from_catalogue(text, template, selector)
            others = templates - {"T_INSOMNIO", "T_HABITOS", "T_HORARIO"}
            if not others:
                text = f"{text} {artifact.templates['T_INSOMNIO.sin_otras_senales']}."
        else:
            text = _fill_from_catalogue(text, template, selector)
        out.append((template, _capitalise(text)))
    return out, selector.used
