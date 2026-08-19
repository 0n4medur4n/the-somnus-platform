"""Approved clinical-source corpus DTOs (build plan §20 Checkpoint 11.3 / §3.6b).

The fifteen clinical sources (SRC-01…SRC-15) the deterministic rules already cite.
The report service fetches them over HTTP and embeds them for explanation-only
grounding; it never reads Morpheo's database. This is professional-grounding data,
served from its own endpoint so it never bloats the SPA-facing assessment content.
"""

from __future__ import annotations

from morpheo.clinical.loader import ClinicalBundle
from morpheo.schemas.base import ContractModel


class ClinicalSourceDTO(ContractModel):
    id: str
    citation: str
    url: str
    use: str


class ClinicalSourcesResponseDTO(ContractModel):
    content_version: str
    sources: list[ClinicalSourceDTO]


def build_clinical_sources(bundle: ClinicalBundle) -> ClinicalSourcesResponseDTO:
    return ClinicalSourcesResponseDTO(
        content_version=bundle.content_version,
        sources=[
            ClinicalSourceDTO(
                id=source.id, citation=source.citation, url=source.url, use=source.use
            )
            for source in bundle.workflows.sources
        ],
    )
