"""Pydantic models mirroring the Morpheo source artifacts (build plan §14a).

These types restate the *structure* of `morpheo_workflows_v1.json` and
`morpheo_claims_registry_v1.csv`, never their clinical content: the artifacts
are the versioned source of truth authored by the Safety Committee, and the
loader (loader.py) enforces them. Every model is strict (`extra="forbid"`) and
frozen, so an unexpected key, a missing required field, or a value outside the
fixed taxonomy (roles, modules, safety levels, claim status) fails loudly.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict


class _Artifact(BaseModel):
    """Strict, immutable base: reject unknown keys, forbid mutation."""

    model_config = ConfigDict(extra="forbid", frozen=True)


# --- Fixed taxonomy (§14a: three roles, six modules, five levels L0-L4,
# three claim statuses). Closed enums so drift or a typo is rejected; a
# genuine addition is a Safety-Committee content-version bump, reviewed. ---


class RoleId(StrEnum):
    ADULT = "adult"
    PARENT = "parent"
    PROFESSIONAL = "professional"


class ModuleId(StrEnum):
    INS = "INS"
    BRE = "BRE"
    SLP = "SLP"
    CIR = "CIR"
    RLS = "RLS"
    PAR = "PAR"


class SafetyLevelId(StrEnum):
    L0 = "L0"
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"
    L4 = "L4"


class ClaimStatus(StrEnum):
    APROBABLE = "APROBABLE"
    CONDICIONAL = "CONDICIONAL"
    BLOQUEAR = "BLOQUEAR"


# --- Sections of morpheo_workflows_v1.json ---


class Meta(_Artifact):
    product: str
    portfolio: str
    version: str
    # Content-only changes (e.g. adding the localized safety-signal questions)
    # bump content_version while the rule/spec `version` stays fixed (§14a).
    # Absent in older artifacts, where content_version binds to `version`.
    content_version: str | None = None
    date: str
    language: str
    scope: str
    not_intended_for: list[str]


class Role(_Artifact):
    id: RoleId
    label: str
    eligibility: str
    output_language: str
    # Only the parent/guardian role carries age bands (§14a: 0-3m … 13-17y).
    age_bands: list[str] | None = None


class StateTransition(_Artifact):
    state: str
    next: str
    # Branching transitions carry a guard condition (e.g. "L0 or stop=true").
    guard: str | None = None


class CoreQuestion(_Artifact):
    id: str
    field: str
    required: bool
    # Present only where the question declares them; absent means unset.
    multi_select: bool | None = None
    allow_unknown: bool | None = None


class SafetyLevel(_Artifact):
    id: SafetyLevelId
    name: str
    color: str
    examples: list[str]
    action: str


class SafetyRule(_Artifact):
    id: str
    priority: int
    when: str
    level: SafetyLevelId
    message: str
    stop: bool
    sources: list[str]


class Module(_Artifact):
    id: ModuleId
    name: str
    entry: list[str]
    minimum_questions: list[str]
    rules: list[str]
    output: str
    sources: list[str]


class OutputContract(_Artifact):
    patient_parent: list[str]
    professional: list[str]
    forbidden_phrases: list[str]


class LlmBoundaries(_Artifact):
    deterministic: list[str]
    generative_allowed: list[str]
    generative_forbidden: list[str]


class DataAndAudit(_Artifact):
    unknown_policy: str
    minimum_log: list[str]
    privacy: str


class ClaimRecord(_Artifact):
    """One claim — the shape is shared by the JSON `claims_registry` and the CSV."""

    id: str
    claim: str
    audience: str
    channel: str
    status: ClaimStatus
    reason: str
    evidence: str
    replacement: str
    owner: str


class TestCase(_Artifact):
    id: str
    scenario: str
    # expected_route / expected_level are human-readable acceptance prose
    # (e.g. "INS + BRE", "L0 y parada"), not machine enums, so they stay str.
    expected_route: str
    expected_level: str
    acceptance: str


class Source(_Artifact):
    id: str
    citation: str
    url: str
    use: str


# --- morpheo_safety_prompts_v1_es.json: the clinically-approved question text
# for each safety-signal atom (build plan §14a / §20 Checkpoint 10.0). The
# engine never authors these; it loads them verbatim and the loader verifies
# they cover exactly the atoms the safety rules use. ---


class SafetyPromptContext(StrEnum):
    GENERAL = "general"
    # Pediatric questions ("su hijo o hija …") are shown only under the
    # parent/guardian role — presentation, not a new engine rule.
    PEDIATRIC = "pediatric"


class SafetyPrompt(_Artifact):
    signal_id: str
    context: SafetyPromptContext
    question: str


class SafetyPromptsMeta(_Artifact):
    version: str
    language: str
    source: str
    answer_format: str
    note: str


class SafetyPrompts(_Artifact):
    """The whole `morpheo_safety_prompts_v1_es.json`."""

    meta: SafetyPromptsMeta
    prompts: list[SafetyPrompt]


class MorpheoWorkflows(_Artifact):
    """The whole `morpheo_workflows_v1.json`."""

    meta: Meta
    roles: list[Role]
    state_machine: list[StateTransition]
    rule_priority: list[str]
    core_questions: list[CoreQuestion]
    safety_levels: list[SafetyLevel]
    safety_rules: list[SafetyRule]
    modules: list[Module]
    output_contract: OutputContract
    llm_boundaries: LlmBoundaries
    data_and_audit: DataAndAudit
    claims_registry: list[ClaimRecord]
    test_cases: list[TestCase]
    sources: list[Source]
