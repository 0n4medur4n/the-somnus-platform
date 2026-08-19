"""The clinical-sources endpoint (build plan §20 Checkpoint 11.3 / §3.6b).

Private, server-to-server: the report service reads the approved SRC-01…SRC-15
corpus to embed for explanation-only grounding. Isolation (§7): the report never
touches Morpheo's database or repositories — it reaches this data only here.
"""

from __future__ import annotations

from fastapi import APIRouter

from morpheo.api.dependencies import BundleDep
from morpheo.schemas.sources import ClinicalSourcesResponseDTO, build_clinical_sources

router = APIRouter(prefix="/internal/v1/clinical-sources", tags=["clinical-sources"])


@router.get(
    "",
    response_model=ClinicalSourcesResponseDTO,
    summary="Approved clinical-source corpus (SRC-01…SRC-15) for report grounding.",
)
def get_clinical_sources(bundle: BundleDep) -> ClinicalSourcesResponseDTO:
    return build_clinical_sources(bundle)
