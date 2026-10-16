"""Report render DTOs (build plan §20 Checkpoint 11.1).

`ReportRenderRequestDTO` mirrors the edge↔report Zod contract (validated against
the shared JSON Schema by the contract test). `ClinicalContentDTO` is the
approved Morpheo wording the report lays out — the report never authors it.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from report.schemas.base import ContractModel

Role = Literal["adult", "parent", "professional"]
SafetyLevel = Literal["L0", "L1", "L2", "L3", "L4"]
Module = Literal["INS", "BRE", "SLP", "CIR", "RLS", "PAR"]
Locale = Literal["es", "en", "ca", "fr"]


class ReportRenderRequestDTO(ContractModel):
    assessment_id: str
    definition_version: str
    content_version: str
    locale: Locale
    role: Role
    level: SafetyLevel | None
    stop: bool
    triggered_rules: list[str]
    routes: list[Module]
    completed_at: str


# --- The approved Morpheo content the report lays out (subset of the content
# endpoint's response; the report only presents it, never restates it). ---


class SafetyLevelContentDTO(ContractModel):
    id: SafetyLevel
    name: str
    action: str


class ModuleContentDTO(ContractModel):
    id: Module
    name: str
    minimum_questions: list[str]
    output: str
    # The module's approved clinical rules; empty from a Morpheo that predates them.
    rules: list[str] = Field(default_factory=list)


class SafetyRuleContentDTO(ContractModel):
    """A safety rule's approved message, written for the person."""

    id: str
    level: SafetyLevel
    message: str


class OutputContractContentDTO(ContractModel):
    patient_parent: list[str]
    professional: list[str]
    forbidden_phrases: list[str]


class ClinicalContentDTO(ContractModel):
    locale: Locale
    content_version: str
    modules: list[ModuleContentDTO]
    safety_levels: list[SafetyLevelContentDTO]
    # The governed limits statements from Morpheo (CLM-006/007/008 replacement
    # text). The report lays them out verbatim; it never authors this text.
    limits_text: list[str]
    # The fired-rule messages (person-facing), by rule id. Empty from an older Morpheo.
    safety_rules: list[SafetyRuleContentDTO] = Field(default_factory=list)
    # Every BLOQUEAR claim statement (§15): feeds the report's forbidden-phrase
    # scanner so AI-reworded output can never state a blocked claim.
    blocked_claims: list[str]
    output_contract: OutputContractContentDTO


class ReportPdfDTO(ContractModel):
    """report -> edge: one report as a PDF, rendered on demand and not stored.

    Base64 because the internal client speaks JSON. The edge decodes it and hands
    the person the file; nothing is kept, so there is no URL to leak or expire.
    """

    assessment_id: str
    template_version: str
    definition_version: str
    content_version: str
    locale: Locale
    created_at: str
    pdf_base64: str


class ReportRefDTO(ContractModel):
    report_id: str
    assessment_id: str
    template_version: str
    definition_version: str
    content_version: str
    locale: Locale
    created_at: str
    html_url: str | None
    pdf_url: str | None
