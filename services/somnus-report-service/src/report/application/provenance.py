"""Describing a provenance record for the reviewer (§B5 Checkpoint 16.5).

The record stamped at generation holds ids and versions. This turns it into
something a human judging AI wording can read, and the way it does that is the
whole reason the record stores ids rather than titles.

Each Index B document is described **as it was at the report's `corpus_version`**,
by asking `documents_live_at` (Checkpoint 16.1) — the same version resolution 16.1
built and 16.4 used, not a third implementation of it. That is what makes a
document retired since generation still read correctly here: retiring keeps the
row, so it is still live *at that version*, and the reviewer sees the material
that actually grounded the report plus the fact that it has since been retired.

Nothing in this module can fail a render or a queue load. §B3.1's rule that Index
B "degrades richness, never correctness" is extended one step further here: a
corpus database that is unreachable, empty, or has never been published to costs
the supporting-material list and leaves the Index A citation — the part that
matters — untouched, because that part is stamped in the record itself.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from report.schemas.provenance import (
    CitationRecord,
    ProvenanceDocument,
    ReportProvenanceRecord,
    ResolvedProvenance,
)
from report.schemas.retrieval import GroundingMaterial, RetrievedSource

logger = logging.getLogger("report.provenance")

#: The Index B documents live at a corpus version, keyed by id. Built over the
#: corpus module's `documents_live_at`, so this layer imports no corpus type and
#: touches no `somnus_content` table itself (ADR 0010 / §7).
LiveDocumentsLoader = Callable[[int], dict[str, ProvenanceDocument]]


class ProvenanceResolver:
    def __init__(self, loader: LiveDocumentsLoader) -> None:
        self._loader = loader

    def resolve(self, record: ReportProvenanceRecord) -> ResolvedProvenance:
        documents: tuple[ProvenanceDocument, ...] = ()
        if record.document_ids:
            documents = tuple(
                self._describe(document_id, self._live_at(record.corpus_version))
                for document_id in record.document_ids
            )

        return ResolvedProvenance(
            corpus_version=record.corpus_version,
            content_version=record.content_version,
            # Straight from the record. Not re-derived, not re-ranked, not
            # dependent on the corpus being reachable (§B3.1).
            citations=record.citations,
            documents=documents,
        )

    def _live_at(self, corpus_version: int) -> dict[str, ProvenanceDocument]:
        if corpus_version <= 0:
            # Nothing had been published when this report was generated, which is
            # every environment today. Not an error — an empty corpus.
            return {}
        try:
            return self._loader(corpus_version)
        except Exception:
            logger.warning("corpus provenance lookup failed; showing ids without titles")
            return {}

    @staticmethod
    def _describe(document_id: str, live: dict[str, ProvenanceDocument]) -> ProvenanceDocument:
        """Never drops an id it cannot describe.

        A document the report rendered must have been live at that version, so an
        id missing from the answer means something is wrong. Showing it untitled
        says so; omitting it would quietly shorten the list a reviewer is using to
        judge whether the wording is grounded.
        """
        found = live.get(document_id)
        if found is not None:
            return found
        return ProvenanceDocument(
            document_id=document_id,
            title="",
            citation="",
            locale="",
            corpus_version_added=None,
            retired_since=False,
        )


#: Opens a `somnus_reporting` session. Typed loosely on purpose: this layer knows
#: it needs a session, not which engine produced one.
SessionFactory = Callable[[], object]


class ProvenanceRecorder:
    """Stamps what grounded a report, once, as it is generated (§B5 16.5).

    Holds the two halves apart: the record is written to `somnus_reporting`, and
    the corpus version it stamps is read from `somnus_content` through a callable
    rather than a repository, so this class imports nothing from the corpus module
    and cannot reach a `somnus_content` table itself (ADR 0010 / §7).
    """

    def __init__(self, session_factory: SessionFactory, corpus_version: Callable[[], int]) -> None:
        self._session_factory = session_factory
        self._corpus_version = corpus_version

    def record(
        self,
        report_id: str,
        *,
        content_version: str,
        locale: str,
        citations: list[RetrievedSource],
        grounding: list[GroundingMaterial],
    ) -> None:
        # Imported here rather than at module scope: the repository knows about
        # SQLAlchemy models, and this module is imported by the render path.
        from report.repositories.provenance_repository import ProvenanceRepository

        corpus_version = self._corpus_version()
        with self._session_factory() as session:  # type: ignore[attr-defined]
            ProvenanceRepository(session).record(
                report_id,
                corpus_version=corpus_version,
                content_version=content_version,
                locale=locale,
                citations=[
                    CitationRecord(
                        source_id=citation.source_id,
                        citation=citation.citation,
                        url=citation.url,
                        resolved_by=citation.resolved_by,
                    )
                    for citation in citations
                ],
                document_ids=[material.document_id for material in grounding],
            )
            session.commit()
