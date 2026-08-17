"""Report render DTOs (build plan §20 Checkpoint 11.1).

`ReportRenderRequestDTO` mirrors the edge↔report Zod contract (validated against
the shared JSON Schema by the contract test). `ClinicalContentDTO` is the
approved Morpheo wording the report lays out — the report never authors it.
"""

from __future__ import annotations

from typing import Literal

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


class OutputContractContentDTO(ContractModel):
    patient_parent: list[str]
    professional: list[str]
    forbidden_phrases: list[str]


class ClinicalContentDTO(ContractModel):
    locale: Locale
    content_version: str
    modules: list[ModuleContentDTO]
    safety_levels: list[SafetyLevelContentDTO]
    output_contract: OutputContractContentDTO


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
