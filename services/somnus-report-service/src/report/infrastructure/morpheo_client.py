"""Fetches the approved clinical content from Morpheo (build plan §5.5 / §5.6).

The report never authors clinical wording; it reads Morpheo's content endpoint
and lays it out. Behind a `ContentProvider` protocol so the render pipeline is
testable without a live Morpheo. Only the fields the report presents are mapped
(the full Morpheo content carries more).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Protocol

import httpx

from report.infrastructure.identity_token import IdentityHeaders
from report.schemas.render import (
    ClinicalContentDTO,
    ModuleContentDTO,
    OutputContractContentDTO,
    SafetyLevelContentDTO,
    SafetyRuleContentDTO,
)


class ContentProvider(Protocol):
    def get_content(self) -> ClinicalContentDTO: ...


def _to_content(raw: dict[str, Any]) -> ClinicalContentDTO:
    return ClinicalContentDTO(
        locale=raw["locale"],
        content_version=raw["contentVersion"],
        modules=[
            ModuleContentDTO(
                id=module["id"],
                name=module["name"],
                minimum_questions=module["minimumQuestions"],
                output=module["output"],
                rules=module.get("rules", []),
            )
            for module in raw["modules"]
        ],
        safety_levels=[
            SafetyLevelContentDTO(id=level["id"], name=level["name"], action=level["action"])
            for level in raw["safetyLevels"]
        ],
        limits_text=raw["limitsText"],
        safety_rules=[
            SafetyRuleContentDTO(id=rule["id"], level=rule["level"], message=rule["message"])
            for rule in raw.get("safetyRules", [])
        ],
        blocked_claims=raw["blockedClaims"],
        output_contract=OutputContractContentDTO(
            patient_parent=raw["outputContract"]["patientParent"],
            professional=raw["outputContract"]["professional"],
            forbidden_phrases=raw["outputContract"]["forbiddenPhrases"],
        ),
    )


class MorpheoContentClient:
    """Reads Morpheo's `/internal/v1/assessments/content` (es today)."""

    def __init__(
        self,
        base_url: str,
        timeout: float = 5.0,
        auth: Callable[[str], dict[str, str]] | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        # Morpheo is private: on Cloud Run each call carries an ID token for it.
        self._auth = auth if auth is not None else IdentityHeaders()

    def get_content(self) -> ClinicalContentDTO:
        response = httpx.get(
            f"{self._base_url}/internal/v1/assessments/content",
            headers=self._auth(self._base_url),
            timeout=self._timeout,
        )
        response.raise_for_status()
        return _to_content(response.json())
