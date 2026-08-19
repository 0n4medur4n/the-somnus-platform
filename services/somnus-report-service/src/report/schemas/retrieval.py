"""Clinical-grounding retrieval DTOs (build plan §3.6b / §14b / Checkpoint 11.3).

Plain data shared by the retriever (application) and the renderer (rendering). A
`RetrievalQuery.text` is always an approved term (a module name) — never PII or
health free-text. A `RetrievedSource` is attached to the professional output as a
citation; it can never carry or change a decision.
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


@dataclass(frozen=True)
class CorpusEntry:
    source_id: str
    citation: str
    url: str
    vector: list[float]
