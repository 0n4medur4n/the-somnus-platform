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
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass

from report.corpus.retrieval import CorpusRetriever
from report.schemas.render import FunnelReportGroundingDTO
from report.schemas.retrieval import GroundingRequest, RetrievalQuery

logger = logging.getLogger("report.funnel_passages")

#: The search is the same for every report of one orientation (fixed sources, fixed
#: terms), and reading the library takes seconds, so a finished search is kept.
CACHE_SECONDS = 30 * 60

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
    def __init__(
        self,
        retriever: CorpusRetriever | None,
        *,
        min_score: float,
        timeout_seconds: float = 20.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._retriever = retriever
        self._min_score = min_score
        self._timeout = timeout_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._cache: dict[
            tuple[tuple[str, ...], tuple[str, ...]], tuple[float, tuple[Passage, ...]]
        ]
        self._cache = {}
        self._running: dict[
            tuple[tuple[str, ...], tuple[str, ...]], Future[tuple[Passage, ...]]
        ] = {}
        self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="funnel-passages")

    def find(self, grounding: FunnelReportGroundingDTO | None) -> tuple[Passage, ...]:
        """The excerpts for this grounding; empty on any failure or when too slow."""
        if self._retriever is None or grounding is None:
            return ()
        key = (tuple(grounding.source_ids), tuple(grounding.queries))
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None and self._clock() - cached[0] < CACHE_SECONDS:
                return cached[1]
            future = self._running.get(key)
            if future is None:
                future = self._pool.submit(self._search, key, grounding)
                self._running[key] = future
        try:
            return future.result(timeout=self._timeout)
        except FutureTimeout:
            # The search goes on in the background and fills the cache: the next
            # report of this orientation has its excerpts at once.
            logger.warning("funnel passages too slow; the page renders without excerpts")
            return ()
        except Exception:
            logger.warning("funnel passages unavailable; the page renders without excerpts")
            return ()

    def _search(
        self, key: tuple[tuple[str, ...], tuple[str, ...]], grounding: FunnelReportGroundingDTO
    ) -> tuple[Passage, ...]:
        try:
            found = self._retrieve(grounding)
            with self._lock:
                self._cache[key] = (self._clock(), found)
            return found
        finally:
            with self._lock:
                self._running.pop(key, None)

    def _retrieve(self, grounding: FunnelReportGroundingDTO) -> tuple[Passage, ...]:
        assert self._retriever is not None
        materials = self._retriever.retrieve(
            # The locale is the loader's concern here: the sources are in the
            # language they were written in, and the loader reads all of them.
            GroundingRequest(locale="", source_ids=tuple(grounding.source_ids)),
            tuple(RetrievalQuery("funnel", query) for query in grounding.queries),
        )
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
