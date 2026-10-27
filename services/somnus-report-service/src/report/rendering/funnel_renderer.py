"""The v2 report (embudo v0.2), rendered deterministically.

A pure function of the request: the same result always produces byte-identical
HTML. Every clinical sentence in it is morpheo's own final text, paragraph by
paragraph -- written only from the v0.2 templates and the approved phrase
catalogue -- plus the completed instrument scores and v0.2's sentence on scales.
Nothing here writes, rewrites, summarises or translates clinical text, and no
model is involved. The report's own words are layout chrome (title, date,
headings), from the locale files.
"""

from __future__ import annotations

from collections.abc import Sequence

from report.application.funnel_passages import Passage
from report.rendering.dates import format_datetime
from report.rendering.i18n import strings_for
from report.rendering.renderer import _env
from report.schemas.render import FunnelReportRequestDTO

TEMPLATE_VERSION_V2 = "report_v2"
TEMPLATE_VERSION_V3 = "report_v3"


def template_version(request: FunnelReportRequestDTO) -> str:
    """The one-page layout when morpheo sent the report block, the v2 layout otherwise."""
    return TEMPLATE_VERSION_V2 if request.report is None else TEMPLATE_VERSION_V3


def render_funnel_html(request: FunnelReportRequestDTO, passages: Sequence[Passage] = ()) -> str:
    version = template_version(request)
    template = _env.get_template(f"{version}.html.j2")
    return template.render(
        strings=strings_for(request.locale),
        request=request,
        template_version=version,
        passages=passages,
        completed_display=format_datetime(request.completed_at, request.locale),
    )
