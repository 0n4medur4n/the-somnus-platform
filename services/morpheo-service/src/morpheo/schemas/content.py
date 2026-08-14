"""Localized assessment display content DTOs (build plan §20 Checkpoint 10.3).

Morpheo serves the versioned artifacts' approved wording (module names + entry
phrases + minimum questions, safety-level names + actions, the output-contract
lines and forbidden phrases) so the SPA renders approved content rather than
restating clinical text (§14a). Only `es` exists today.
"""

from __future__ import annotations

from typing import Literal

from morpheo.clinical.loader import ClinicalBundle
from morpheo.clinical.models import ModuleId, SafetyLevelId
from morpheo.schemas.base import ContractModel


class AssessmentModuleContentDTO(ContractModel):
    id: ModuleId
    name: str
    entry: list[str]
    minimum_questions: list[str]
    output: str


class SafetyLevelContentDTO(ContractModel):
    id: SafetyLevelId
    name: str
    action: str


class OutputContractContentDTO(ContractModel):
    patient_parent: list[str]
    professional: list[str]
    forbidden_phrases: list[str]


class AssessmentContentResponseDTO(ContractModel):
    locale: Literal["es", "en", "ca", "fr"]
    workflow_version: str
    content_version: str
    modules: list[AssessmentModuleContentDTO]
    safety_levels: list[SafetyLevelContentDTO]
    output_contract: OutputContractContentDTO


def build_content_response(bundle: ClinicalBundle) -> AssessmentContentResponseDTO:
    workflows = bundle.workflows
    return AssessmentContentResponseDTO(
        locale="es",
        workflow_version=workflows.meta.version,
        content_version=workflows.meta.version,
        modules=[
            AssessmentModuleContentDTO(
                id=module.id,
                name=module.name,
                entry=list(module.entry),
                minimum_questions=list(module.minimum_questions),
                output=module.output,
            )
            for module in workflows.modules
        ],
        safety_levels=[
            SafetyLevelContentDTO(id=level.id, name=level.name, action=level.action)
            for level in workflows.safety_levels
        ],
        output_contract=OutputContractContentDTO(
            patient_parent=list(workflows.output_contract.patient_parent),
            professional=list(workflows.output_contract.professional),
            forbidden_phrases=list(workflows.output_contract.forbidden_phrases),
        ),
    )
