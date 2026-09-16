"""Describing a provenance record for a reviewer (§B5 Checkpoint 16.5).

The record stamped at generation holds ids and versions. Turning those into
something a human can read is this module's whole job, and two properties of how
it does that are worth pinning:

* **Index A's citations come from the record, not from a lookup.** They are
  stamped, so they survive a corpus that is empty, unreachable or has moved on.
  §B3.1's "costs richness, never correctness" reaches the review UI here.
* **Index B's documents are described as they were at that `corpus_version`**,
  through `documents_live_at` (Checkpoint 16.1). A document retired since the
  report was generated is still described, and flagged as retired.
"""

from __future__ import annotations

from report.application.provenance import ProvenanceResolver
from report.schemas.provenance import (
    CitationRecord,
    ProvenanceDocument,
    ReportProvenanceRecord,
)

CITATION = CitationRecord(
    source_id="SRC-02",
    citation="Kapur VK. Diagnostic Testing for Adult OSA.",
    url="https://example.org/src-02",
    resolved_by="rule",
)


def _record(
    *, corpus_version: int = 7, document_ids: tuple[str, ...] = ("d-1",)
) -> ReportProvenanceRecord:
    return ReportProvenanceRecord(
        report_id="report-1",
        corpus_version=corpus_version,
        content_version="1.2",
        locale="es",
        citations=(CITATION,),
        document_ids=document_ids,
    )


def _document(document_id: str, *, retired: bool = False) -> ProvenanceDocument:
    return ProvenanceDocument(
        document_id=document_id,
        title="Higiene del sueño",
        citation="The Somnus (2026).",
        locale="es",
        corpus_version_added=3,
        retired_since=retired,
    )


def test_it_describes_each_document_as_it_was_at_that_corpus_version() -> None:
    asked: list[int] = []

    def loader(corpus_version: int) -> dict[str, ProvenanceDocument]:
        asked.append(corpus_version)
        return {"d-1": _document("d-1")}

    resolved = ProvenanceResolver(loader).resolve(_record())

    # The version from the record, not the current one.
    assert asked == [7]
    assert [document.title for document in resolved.documents] == ["Higiene del sueño"]
    assert resolved.corpus_version == 7
    assert resolved.content_version == "1.2"


def test_a_document_retired_since_generation_is_still_described_and_flagged() -> None:
    """§B3's reason for retiring instead of deleting, reaching the review UI.

    The material is still what grounded this report. It is no longer what would
    ground a new one, and a reviewer is told both.
    """
    resolved = ProvenanceResolver(lambda _v: {"d-1": _document("d-1", retired=True)}).resolve(
        _record()
    )

    assert [document.document_id for document in resolved.documents] == ["d-1"]
    assert resolved.documents[0].retired_since is True
    assert resolved.documents[0].title == "Higiene del sueño"


def test_the_citations_come_from_the_record_whatever_the_corpus_does() -> None:
    """The one thing that must not depend on a lookup (§B3.1)."""

    def exploding(_corpus_version: int) -> dict[str, ProvenanceDocument]:
        raise RuntimeError("somnus_content is unreachable")

    resolved = ProvenanceResolver(exploding).resolve(_record())

    assert [citation.source_id for citation in resolved.citations] == ["SRC-02"]
    assert resolved.citations[0].citation == CITATION.citation
    # The document could not be described, and is shown untitled rather than
    # dropped: the count a reviewer sees still matches what grounded the report.
    assert [document.document_id for document in resolved.documents] == ["d-1"]
    assert resolved.documents[0].title == ""


def test_a_report_generated_against_an_empty_corpus_costs_no_lookup() -> None:
    """Every environment today (16.4): Index B unwired, corpus version 0."""
    asked: list[int] = []

    def loader(corpus_version: int) -> dict[str, ProvenanceDocument]:
        asked.append(corpus_version)
        return {}

    resolved = ProvenanceResolver(loader).resolve(_record(corpus_version=0, document_ids=()))

    assert asked == []
    assert resolved.documents == ()
    # And the citation is there, which is the half that matters.
    assert [citation.source_id for citation in resolved.citations] == ["SRC-02"]


def test_an_id_the_corpus_cannot_describe_is_shown_rather_than_hidden() -> None:
    resolved = ProvenanceResolver(lambda _v: {"d-1": _document("d-1")}).resolve(
        _record(document_ids=("d-1", "d-missing"))
    )

    assert [document.document_id for document in resolved.documents] == ["d-1", "d-missing"]
    assert resolved.documents[1].title == ""


def test_the_documents_keep_the_order_the_report_rendered_them_in() -> None:
    live = {"d-1": _document("d-1"), "d-2": _document("d-2")}
    resolved = ProvenanceResolver(lambda _v: live).resolve(_record(document_ids=("d-2", "d-1")))
    assert [document.document_id for document in resolved.documents] == ["d-2", "d-1"]
