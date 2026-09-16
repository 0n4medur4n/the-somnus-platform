"""Corpus provenance as plain data (Addendum B §B5 Checkpoint 16.5).

In `schemas` rather than beside either repository because both halves need it and
they live in different logical databases: the record is written and read in
`somnus_reporting`, and the Index B documents it names are described from
`somnus_content`. Neither module imports the other; they share these shapes.

The split between `ReportProvenanceRecord` and `ResolvedProvenance` is the point
of the design:

* The **record** is what was stamped at generation and never changes — the corpus
  version, the citations as rendered, and the ids of the documents that were
  rendered.
* The **resolved** view is that record described for a human, with each document
  id turned into a title *as it was at that corpus version*. That resolution runs
  at display time against `documents_live_at` (Checkpoint 16.1), which is why a
  document retired since generation still reads correctly in an older report's
  provenance.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CitationRecord:
    """One Index A citation, exactly as the report rendered it."""

    source_id: str
    citation: str
    url: str
    # "rule" when the fired rule named it, "similarity" for the fallback path.
    resolved_by: str


@dataclass(frozen=True)
class ReportProvenanceRecord:
    """The immutable stamp. Ids and versions, no titles."""

    report_id: str
    corpus_version: int
    content_version: str
    locale: str
    citations: tuple[CitationRecord, ...]
    document_ids: tuple[str, ...]


@dataclass(frozen=True)
class ProvenanceDocument:
    """One Index B document, described as it was at the report's corpus version."""

    document_id: str
    title: str
    citation: str
    locale: str
    corpus_version_added: int | None
    # True when the document has since been retired. Worth showing a reviewer:
    # the material is still what grounded this report, and is no longer what
    # would ground a new one.
    retired_since: bool


@dataclass(frozen=True)
class ResolvedProvenance:
    """The record, described for the reviewer looking at it."""

    corpus_version: int
    content_version: str
    citations: tuple[CitationRecord, ...]
    documents: tuple[ProvenanceDocument, ...]
