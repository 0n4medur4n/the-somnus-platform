"""Verbatim passages that back the report's orientation, for the professional's page.

The engine decides the orientation; this only finds where the library says
something about it. Morpheo names the sources that back each orientation and the
approved sentences of the orientation to search with (never anything about the
person: `FunnelReportGroundingDTO` has no field that could carry it). Each
published document of those sources is searched by similarity, its best chunk is
kept if it is close enough, and it is shown word for word with the document's title
and citation. No model writes or rewrites any of it.

Supporting material only, by construction: this returns `Passage`, which is not a
citation and cannot become one. A failure -- no embedding key, the provider down,
the library empty -- costs the page its excerpts and nothing else; the PDF is
always rendered.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from report.corpus.retrieval import CorpusRetriever
from report.schemas.render import FunnelReportGroundingDTO
from report.schemas.retrieval import GroundingRequest, RetrievalQuery

logger = logging.getLogger("report.funnel_passages")

#: Excerpts on the page; it is read in a consultation, not browsed.
MAX_PASSAGES = 4
#: Shorter than this a chunk is a heading, not a passage (a title scored 0.67 in the probe).
MIN_CHARS = 160
#: The longest excerpt shown. A chunk is at most 1,200 characters; this keeps the
#: page to one sheet and only ever cuts the end, so what is shown stays verbatim.
MAX_EXCERPT = 1_000


@dataclass(frozen=True)
class Passage:
    source_id: str
    title: str
    citation: str
    text: str
    score: float


def excerpt(text: str) -> str:
    """The text with its whitespace collapsed, cut at a word boundary if too long."""
    flat = " ".join(text.split())
    if len(flat) <= MAX_EXCERPT:
        return flat
    cut = flat[:MAX_EXCERPT].rsplit(" ", 1)[0]
    return f"{cut} …"


class FunnelPassages:
    def __init__(self, retriever: CorpusRetriever | None, *, min_score: float) -> None:
        self._retriever = retriever
        self._min_score = min_score

    def find(self, grounding: FunnelReportGroundingDTO | None) -> tuple[Passage, ...]:
        if self._retriever is None or grounding is None:
            return ()
        try:
            materials = self._retriever.retrieve(
                # The locale is the loader's concern here: the sources are in the
                # language they were written in, and the loader reads all of them.
                GroundingRequest(locale="", source_ids=tuple(grounding.source_ids)),
                tuple(RetrievalQuery("funnel", query) for query in grounding.queries),
            )
        except Exception:
            logger.warning("funnel passages unavailable; the page renders without excerpts")
            return ()
        kept = [
            m
            for m in materials
            if m.score >= self._min_score and len(" ".join(m.text.split())) >= MIN_CHARS
        ]
        kept.sort(key=lambda m: (-m.score, m.document_id))
        return tuple(
            Passage(m.matched_scope_key, m.title, m.citation, excerpt(m.text), round(m.score, 3))
            for m in kept[:MAX_PASSAGES]
        )
