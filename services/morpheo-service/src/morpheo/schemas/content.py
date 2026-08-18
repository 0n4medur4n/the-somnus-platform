"""Localized assessment display content DTOs (build plan §20 Checkpoint 10.3).

Morpheo serves the versioned artifacts' approved wording (module names + entry
phrases + minimum questions, safety-level names + actions, the output-contract
lines and forbidden phrases) so the SPA renders approved content rather than
restating clinical text (§14a). Only `es` exists today.
"""

from __future__ import annotations

from typing import Literal

from morpheo.clinical.loader import ClinicalBundle
from morpheo.clinical.models import ClaimStatus, ModuleId, SafetyLevelId
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


class SafetyPromptContentDTO(ContractModel):
    signal_id: str
    context: Literal["general", "pediatric"]
    question: str


# The governed limits statements are the approved CLM replacement text, in
# order, served verbatim as three separate sentences (build plan §14b / §15).
_LIMITS_CLAIM_IDS = ("CLM-006", "CLM-007", "CLM-008")


class AssessmentContentResponseDTO(ContractModel):
    locale: Literal["es", "en", "ca", "fr"]
    workflow_version: str
    content_version: str
    modules: list[AssessmentModuleContentDTO]
    safety_levels: list[SafetyLevelContentDTO]
    safety_prompts: list[SafetyPromptContentDTO]
    limits_text: list[str]
    blocked_claims: list[str]
    output_contract: OutputContractContentDTO


def build_content_response(bundle: ClinicalBundle) -> AssessmentContentResponseDTO:
    workflows = bundle.workflows
    claims_by_id = {claim.id: claim for claim in workflows.claims_registry}
    limits_text = [claims_by_id[claim_id].replacement for claim_id in _LIMITS_CLAIM_IDS]
    # Every BLOQUEAR claim statement, for a consumer's forbidden-phrase scanner (§15).
    blocked_claims = [
        claim.claim
        for claim in sorted(workflows.claims_registry, key=lambda entry: entry.id)
        if claim.status is ClaimStatus.BLOQUEAR
    ]
    return AssessmentContentResponseDTO(
        locale="es",
        workflow_version=bundle.workflow_version,
        content_version=bundle.content_version,
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
        safety_prompts=[
            SafetyPromptContentDTO(
                signal_id=prompt.signal_id, context=prompt.context.value, question=prompt.question
            )
            for prompt in bundle.safety_prompts.prompts
        ],
        limits_text=limits_text,
        blocked_claims=blocked_claims,
        output_contract=OutputContractContentDTO(
            patient_parent=list(workflows.output_contract.patient_parent),
            professional=list(workflows.output_contract.professional),
            forbidden_phrases=list(workflows.output_contract.forbidden_phrases),
        ),
    )
