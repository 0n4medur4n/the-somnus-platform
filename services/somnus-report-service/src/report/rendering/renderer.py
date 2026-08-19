"""Deterministic HTML rendering (build plan §20 Checkpoint 11.1).

A pure function of (request, approved content, template version): the same input
always produces byte-identical HTML. It lays out Morpheo's approved wording; it
never recalculates the level, the routing, or any decision (§5.6). The template
version and the definition/content versions are stamped into every output.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from report.rendering.i18n import strings_for
from report.schemas.render import ClinicalContentDTO, ReportRenderRequestDTO
from report.schemas.retrieval import RetrievedSource

TEMPLATE_VERSION = "report_v1"
_TEMPLATES_DIR = Path(__file__).parent / "templates"

# autoescape is forced on (not name-sniffed) so every clinical string the
# report lays out is HTML-escaped — defense against markup in the content.
_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=True,
    trim_blocks=True,
    lstrip_blocks=True,
    keep_trailing_newline=True,
)

_MAX_PATTERNS = 3


@dataclass(frozen=True)
class RenderedReport:
    html: str
    template_version: str
    definition_version: str
    content_version: str
    locale: str


def render_html(
    request: ReportRenderRequestDTO,
    content: ClinicalContentDTO,
    template_version: str = TEMPLATE_VERSION,
    citations: Sequence[RetrievedSource] = (),
) -> RenderedReport:
    modules_by_id = {module.id: module for module in content.modules}
    routed = [modules_by_id[route] for route in request.routes if route in modules_by_id]
    level = next(
        (safety for safety in content.safety_levels if safety.id == request.level),
        None,
    )
    template = _env.get_template(f"{template_version}.html.j2")
    html = template.render(
        strings=strings_for(request.locale),
        request=request,
        level=level,
        routed=routed[:_MAX_PATTERNS],
        # The limits statements come from Morpheo (governed content), never the
        # report's own locale files.
        limits_text=content.limits_text,
        show_framing=request.level in ("L3", "L4"),
        # The emergency notice is triggered EXCLUSIVELY by Morpheo's structured
        # level being L0 — no other field or heuristic may show it (§14b / §15,
        # clinical-governance condition; see README).
        is_emergency=request.level == "L0",
        # Explanation-only grounding (§3.6b): citations attach to the professional
        # output. They render into their own section and NEVER affect the level,
        # the routing, or any other content — proven by the determinism test.
        citations=citations,
        template_version=template_version,
    )
    return RenderedReport(
        html=html,
        template_version=template_version,
        definition_version=request.definition_version,
        content_version=request.content_version,
        locale=request.locale,
    )
