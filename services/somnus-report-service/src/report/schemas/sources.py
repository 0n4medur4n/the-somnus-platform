"""The clinical-source corpus as the report sees it (build plan §3.6b / 11.3).

Mirrors Morpheo's `ClinicalSourcesResponse` (the single source of truth). The
report fetches these over HTTP and embeds them for explanation-only grounding; it
never authors clinical wording or reads Morpheo's database.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ClinicalSourceDTO:
    id: str
    citation: str
    url: str
    use: str
    # The safety rules that cite this source (Checkpoint 11.3 Stage 4). Defaulted
    # so the many test fixtures that predate the field still construct, and empty
    # is the honest value for them: a source no rule cites.
    cited_by_rules: tuple[str, ...] = ()


@dataclass(frozen=True)
class ClinicalSourcesDTO:
    content_version: str
    sources: list[ClinicalSourceDTO]


@dataclass(frozen=True)
class EmbeddedSourceDTO:
    source: ClinicalSourceDTO
    vector: list[float]
