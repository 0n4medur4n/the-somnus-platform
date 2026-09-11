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
