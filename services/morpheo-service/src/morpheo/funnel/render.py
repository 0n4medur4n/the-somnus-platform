"""The final text: v0.2 templates (pp. 11-12), filled from the phrase catalogue.

No model writes here. Each [placeholder] takes phrases from the closed
catalogue (`morpheo.funnel.catalogue`), chosen by the confirmed answers; the
person's own words never enter a template. Where v0.2 gives only a system
instruction or no text at all (T_SEGURIDAD's action, the drowsy-driver
warning, recent insomnia with high impact), the text is the catalogue's draft
for the clinical lead to approve.
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


def _fill_from_catalogue(text: str, template: str, selector: Selector) -> str:
    for name in selector.c.placeholders.get(template, {}):
        text = _fill(text, name, selector.placeholder(template, name))
    return text


def question_text(
    definition: StepDef, iv: Interview, catalogue: Catalogue | None = None
) -> tuple[str, list[str]]:
    """The question as the person sees it.

    Z1 carries the summary to confirm; the steps v0.2 gives only as an
    instruction (the S2 warning and safe-place question) carry their draft.
    """
    selector = Selector(catalogue or funnel_catalogue(), iv)
    if definition.id in selector.c.drafts:
        return selector.draft(definition.id), selector.used
    if definition.id != "Z1":
        return definition.text, []
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
    templates = {o.template for o in orientations}
    for o in orientations:
        template = o.template
        if template is None:
            continue
        if template in selector.c.drafts:
            out.append((template, selector.draft(template)))
            continue
        text = _strip(artifact.templates[template])
        if template == "T_SOMNOLENCIA" and iv.safety("S2") == YES:
            out.append(("S2_aviso", selector.draft("S2_aviso")))
            text = _fill_from_catalogue(text, template, selector)
        elif template == "T_INSOMNIO":
            text = _fill_from_catalogue(text, template, selector)
            others = templates - {"T_INSOMNIO", "T_HABITOS", "T_HORARIO"}
            if not others:
                text = f"{text} {artifact.templates['T_INSOMNIO.sin_otras_senales']}."
        else:
            text = _fill_from_catalogue(text, template, selector)
        out.append((template, _capitalise(text)))
    return out, selector.used
