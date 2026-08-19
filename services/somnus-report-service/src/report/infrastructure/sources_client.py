"""Fetches the approved clinical-source corpus from Morpheo (build plan §3.6b).

The report embeds these sources for explanation-only grounding; it reads them over
HTTP from Morpheo's dedicated `/internal/v1/clinical-sources` endpoint and never
touches Morpheo's database (§7 isolation). Behind a `SourcesProvider` protocol so
the indexer is testable without a live Morpheo.
"""

from __future__ import annotations

from typing import Any, Protocol

import httpx

from report.schemas.sources import ClinicalSourceDTO, ClinicalSourcesDTO


class SourcesProvider(Protocol):
    def get_sources(self) -> ClinicalSourcesDTO: ...


def _to_sources(raw: dict[str, Any]) -> ClinicalSourcesDTO:
    return ClinicalSourcesDTO(
        content_version=raw["contentVersion"],
        sources=[
            ClinicalSourceDTO(
                id=source["id"],
                citation=source["citation"],
                url=source["url"],
                use=source["use"],
            )
            for source in raw["sources"]
        ],
    )


class MorpheoSourcesClient:
    """Reads Morpheo's `/internal/v1/clinical-sources` (the approved SRC corpus)."""

    def __init__(self, base_url: str, timeout: float = 5.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    def get_sources(self) -> ClinicalSourcesDTO:
        response = httpx.get(
            f"{self._base_url}/internal/v1/clinical-sources", timeout=self._timeout
        )
        response.raise_for_status()
        return _to_sources(response.json())
