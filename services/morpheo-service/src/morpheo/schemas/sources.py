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
    # The safety rules that cite this source, inverted from `safety_rules[].sources`
    # in the artifact (Checkpoint 11.3 Stage 4). It is what lets the report cite the
    # source the fired rule actually named instead of whichever one a similarity
    # search ranked first (§14b). Empty for a source no rule cites.
    cited_by_rules: list[str]


class ClinicalSourcesResponseDTO(ContractModel):
    content_version: str
    sources: list[ClinicalSourceDTO]


def _rules_by_source(bundle: ClinicalBundle) -> dict[str, list[str]]:
    """Invert `safety_rules[].sources` into source -> citing rules.

    Sorted, so the same artifact always produces the same response and a report
    grounded twice on one `content_version` cites in the same order both times.
    """
    citing: dict[str, list[str]] = {}
    for rule in bundle.workflows.safety_rules:
        for source_id in rule.sources:
            citing.setdefault(source_id, []).append(rule.id)
    return {source_id: sorted(set(rules)) for source_id, rules in citing.items()}


def build_clinical_sources(bundle: ClinicalBundle) -> ClinicalSourcesResponseDTO:
    citing = _rules_by_source(bundle)
    return ClinicalSourcesResponseDTO(
        content_version=bundle.content_version,
        sources=[
            ClinicalSourceDTO(
                id=source.id,
                citation=source.citation,
                url=source.url,
                use=source.use,
                cited_by_rules=citing.get(source.id, []),
            )
            for source in bundle.workflows.sources
        ],
    )
