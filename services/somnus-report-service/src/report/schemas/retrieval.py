"""Clinical-grounding retrieval DTOs (build plan §3.6b / §14b / Checkpoint 11.3).

Plain data shared by the retriever (application) and the renderer (rendering). A
`RetrievalQuery.text` is always an approved term (a module name) — never PII or
health free-text. A `RetrievedSource` is attached to the professional output as a
citation; it can never carry or change a decision.

A `RetrievedSource` from the by-id path carries no meaningful score -- it was not
ranked against anything, it was named by the rule -- so `score` is 1.0 there and
the `resolved_by` field says which path produced it.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RetrievalQuery:
    module_id: str
    text: str


@dataclass(frozen=True)
class RetrievedSource:
    source_id: str
    citation: str
    url: str
    score: float
    # "rule" when the fired rule named this source, "similarity" when it was
    # ranked. Kept so a report's grounding can be explained after the fact
    # without re-running retrieval.
    resolved_by: str = "similarity"


@dataclass(frozen=True)
class CorpusEntry:
    source_id: str
    citation: str
    url: str
    vector: list[float]
    # The safety rules that cite this source. The by-id citation path filters on
    # this; the similarity path ignores it.
    cited_by_rules: tuple[str, ...] = ()


@dataclass(frozen=True)
class GroundingMaterial:
    """Supporting material from Index B (Addendum B §B3.1 / Checkpoint 16.4).

    A separate type from `RetrievedSource`, and that is the guarantee rather than
    a naming choice. §B3.1 requires the citation to resolve from Index A whatever
    Index B does; the citation path produces `RetrievedSource` and nothing in the
    corpus module can construct one, so no state of Index B — empty, wrong or
    raising — can reach a citation. It attaches beside one, never as one.
    """

    document_id: str
    title: str
    citation: str
    locale: str
    corpus_version_added: int | None
    # Which activated scope pulled this in, so a report's grounding can be
    # explained after the fact without re-running retrieval.
    matched_scope_type: str
    matched_scope_key: str
    text: str
    score: float


@dataclass(frozen=True)
class GroundingRequest:
    """What a deterministic result activated, and the locale it renders in (16.4).

    In `schemas` rather than beside the retriever so the application layer can
    describe a query without importing the corpus module, and so the shape stays
    obvious: ids and a locale. There is no field here that could carry an answer,
    a free-text note, or anything about the person assessed.
    """

    locale: str
    module_ids: tuple[str, ...] = ()
    rule_ids: tuple[str, ...] = ()
    source_ids: tuple[str, ...] = ()
