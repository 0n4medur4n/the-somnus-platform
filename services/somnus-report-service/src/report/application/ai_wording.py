"""Controlled AI wording, applied per sentence (build plan §15).

Which sentences the AI may reword, and how approved rewordings reach a report.

The AI never sees anything about a person. It rewords the report's FIXED approved
sentences -- each clinical pattern's summary (`module.output`) and each care
level's recommended action (`level.action`) -- which are the same for everyone
who gets that pattern or level. Each one is reviewed once, by a human, in the
content review queue; only an approved rewording is ever printed (§15), and a
sentence without one is printed exactly as Morpheo approved it.

Never reworded, on purpose:

* L0 and L1 actions. They are the emergency and urgent instructions ("llama al
  112", "no conduzcas"): their exact wording is the safety measure, so it is not
  open to rephrasing, however well reviewed.
* Level and pattern names, the questions to prepare, the limits statements. They
  are labels and governed statements, not prose to make friendlier.

The level, the routing and every decision are untouched by construction: this
module receives Morpheo's content and returns the same content with some
sentences swapped for their approved rewordings. Nothing here reads the request.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

from report.schemas.render import ClinicalContentDTO

logger = logging.getLogger("report.ai_wording")

# Care levels whose action is never reworded (see module docstring).
_VERBATIM_LEVELS = frozenset({"L0", "L1"})


@dataclass(frozen=True)
class RewritableText:
    """One fixed sentence the AI may reword, and where it comes from."""

    text_ref: str
    text: str


def rewritable_texts(content: ClinicalContentDTO) -> list[RewritableText]:
    """Every sentence in this content version that may be reworded."""
    texts = [RewritableText(f"module:{module.id}", module.output) for module in content.modules]
    texts += [
        RewritableText(f"level:{level.id}", level.action)
        for level in content.safety_levels
        if level.id not in _VERBATIM_LEVELS
    ]
    return [entry for entry in texts if entry.text.strip()]


class ApprovedWording(Protocol):
    """The one question the render pipeline may ask the review queue."""

    def approved_rewrite(self, deterministic_text: str) -> str | None: ...


def apply_approved_wording(
    content: ClinicalContentDTO, wording: ApprovedWording
) -> ClinicalContentDTO:
    """The content with each reviewable sentence replaced by its approved rewording.

    A sentence with no approval -- pending, rejected, never generated -- stays
    as Morpheo wrote it. A failing lookup also leaves it as written: the AI
    wording is an improvement to the report, never a condition for producing it.
    """

    def reworded(text: str) -> str:
        try:
            approved = wording.approved_rewrite(text)
        except Exception:
            logger.warning("approved wording lookup failed; using the approved original")
            return text
        return approved if approved else text

    return content.model_copy(
        update={
            "modules": [
                module.model_copy(update={"output": reworded(module.output)})
                for module in content.modules
            ],
            "safety_levels": [
                level
                if level.id in _VERBATIM_LEVELS
                else level.model_copy(update={"action": reworded(level.action)})
                for level in content.safety_levels
            ],
        }
    )
