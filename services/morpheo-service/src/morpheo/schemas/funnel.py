"""The v2 interview DTOs: the Python side of `packages/api-contracts/src/morpheo/funnel.ts`.

Validated against the same generated JSON Schema as the TypeScript side by the
contract test, so a drift on either side fails CI.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from morpheo.schemas.base import ContractModel

FunnelAbsence = Literal["no_lo_se", "prefiero_no_responder"]
FunnelStepKind = Literal["ask", "confirm", "info", "instrument_intro", "confirm_extraction"]
FunnelAnswerType = Literal[
    "number",
    "yes_no",
    "yes_no_note",
    "free_text",
    "duration",
    "times",
    "multi",
    "single",
    "info",
    "instrument_intro",
    "confirm_extraction",
]
FunnelPhase = Literal["start", "story", "branches", "instrument", "protection", "closing"]
FunnelStatus = Literal["open", "finished", "stopped", "paused"]
FunnelInstrumentStatus = Literal["completed", "declined", "incomplete", "pending_file"]
FunnelExtractionDecision = Literal["confirmado", "corregido", "quitado"]
FunnelRisk = Literal["si", "no", "dudoso"]


class FunnelOptionDTO(ContractModel):
    key: str
    label: str


class FunnelInstrumentDTO(ContractModel):
    code: str
    name: str | None
    status: FunnelInstrumentStatus
    total: int | None
    band: str | None
    placement: str


class FunnelAiItemPanelDTO(ContractModel):
    id: str
    question: str
    answer: str
    evidence: str
    decision: FunnelExtractionDecision | Literal["pendiente"]
    corrected: str | None


class FunnelAiRiskDTO(ContractModel):
    s1: FunnelRisk | None = Field(alias="S1")
    s4: FunnelRisk | None = Field(alias="S4")
    s2: FunnelRisk | None = Field(alias="S2")


class FunnelAiPanelDTO(ContractModel):
    source: str
    status: Literal["ok", "failed"]
    model: str | None
    prompt_version: str | None
    risk: FunnelAiRiskDTO
    discarded: int
    items: list[FunnelAiItemPanelDTO]


class FunnelStepPanelDTO(ContractModel):
    reason: str | None
    source: str
    branches_opened: list[str]
    rules_fired: list[str]
    main_action: str | None
    phrase_ids: list[str]
    instruments: list[FunnelInstrumentDTO]
    ai: list[FunnelAiPanelDTO]


class FunnelStepInstrumentDTO(ContractModel):
    code: str
    name: str


class FunnelExtractionItemDTO(ContractModel):
    id: str
    question: str
    answer: str
    evidence: str
    editable: bool
    type: FunnelAnswerType
    options: list[FunnelOptionDTO]
    fields: list[FunnelOptionDTO]
    none_option: bool
    unit: str | None
    units: list[str]


class FunnelExtractionDTO(ContractModel):
    source: str
    items: list[FunnelExtractionItemDTO]


class FunnelStepDTO(ContractModel):
    key: str
    question_id: str
    kind: FunnelStepKind
    type: FunnelAnswerType
    text: str
    note: str | None
    options: list[FunnelOptionDTO]
    fields: list[FunnelOptionDTO]
    none_option: bool
    unit: str | None
    units: list[str]
    allow_absence: bool
    instrument: FunnelStepInstrumentDTO | None
    phase: FunnelPhase
    answered_count: int
    extraction: FunnelExtractionDTO | None
    panel: FunnelStepPanelDTO | None


class FunnelTextDTO(ContractModel):
    template: str
    text: str


class FunnelOrientationDTO(ContractModel):
    category: str
    template: str | None
    rule: str
    why: str


class FunnelResultPanelDTO(ContractModel):
    rule_ids: list[str]
    trace: list[str]
    flags: list[str]
    pending_data: list[str]
    phrase_ids: list[str]
    branches_opened: list[str]
    orientations: list[FunnelOrientationDTO]
    instruments: list[FunnelInstrumentDTO]
    ai: list[FunnelAiPanelDTO]


class FunnelReportResourceDTO(ContractModel):
    code: str
    text: str


class FunnelReportHelpDTO(ContractModel):
    sentences: list[str]
    resources: list[FunnelReportResourceDTO]


class FunnelReportFlagDTO(ContractModel):
    id: str
    reasons: list[str]


class FunnelReportSafetyDTO(ContractModel):
    question: str
    answer: str
    when: Literal["moment", "end", "confirmed"]


class FunnelReportAnswerDTO(ContractModel):
    id: str
    question: str
    answer: str
    origin: Literal["answered", "narrative", "corrected"]


class FunnelReportProfessionalDTO(ContractModel):
    main_action: str | None
    associated_actions: list[str]
    templates: list[str]
    rules: list[str]
    flags: list[FunnelReportFlagDTO]
    alerts: list[str]
    pending_data: list[str]
    safety: list[FunnelReportSafetyDTO]
    answers: list[FunnelReportAnswerDTO]
    narrative: str | None


class FunnelReportDTO(ContractModel):
    layout: Literal["urgent", "standard"]
    headline: list[str]
    secondary: list[str]
    summary: str | None
    steps: list[str]
    help: FunnelReportHelpDTO
    limits: list[str]
    sources: list[str]
    professional: FunnelReportProfessionalDTO | None


class FunnelResultDTO(ContractModel):
    stopped_by: str | None
    alerts: list[str]
    main_action: str | None
    associated_actions: list[str]
    test_to_consider: str | None
    texts: list[FunnelTextDTO]
    instruments: list[FunnelInstrumentDTO]
    instruments_note: str | None
    content_version: str
    rules_version: str
    report: FunnelReportDTO | None = None
    panel: FunnelResultPanelDTO | None


class FunnelHistoryItemDTO(ContractModel):
    key: str
    question: str
    answer: str


class FunnelStateDTO(ContractModel):
    session_id: str
    status: FunnelStatus
    step: FunnelStepDTO | None
    result: FunnelResultDTO | None
    history: list[FunnelHistoryItemDTO]
    owned: bool


class FunnelCreateRequestDTO(ContractModel):
    consent_given: Literal[True]


class FunnelDurationDTO(ContractModel):
    value: float = Field(gt=0, le=1000)
    unit: str = Field(min_length=1, max_length=16)


FunnelValue = str | int | list[str] | FunnelDurationDTO | dict[str, str]


class FunnelExtractionDecisionDTO(ContractModel):
    id: str = Field(min_length=1, max_length=64)
    decision: FunnelExtractionDecision
    value: FunnelValue | None = None


class FunnelAnswerRequestDTO(ContractModel):
    key: str = Field(min_length=1, max_length=64)
    value: FunnelValue | None = None
    absence: FunnelAbsence | None = None
    text: str | None = Field(default=None, max_length=2000)
    # The confirmation screen: the person's decision on each proposed item.
    decisions: list[FunnelExtractionDecisionDTO] | None = Field(default=None, max_length=60)

    @model_validator(mode="after")
    def _one_of(self) -> FunnelAnswerRequestDTO:
        given = [self.value is not None, self.absence is not None, self.decisions is not None]
        if sum(given) != 1:
            raise ValueError("exactly one of value, absence and decisions")
        return self


class FunnelRewindRequestDTO(ContractModel):
    key: str = Field(min_length=1, max_length=64)


class FunnelConfigResponseDTO(ContractModel):
    active_flow: Literal["v1", "v2"]
