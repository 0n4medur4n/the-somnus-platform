"""The person's report, written by the AI from their structured result.

Owner decision 2026-10-16 (build plan §15 amended): generated live for each
assessment and shown without human review. The guardrails are structural and
live in report.application.narrative: the AI never sees who the person is, never
decides the level, never writes the urgent instructions, and its text is
discarded -- falling back to the protocol's own wording -- if the forbidden-phrase
scanner or this schema rejects it.
"""

from __future__ import annotations

from pydantic import Field

from report.schemas.base import ContractModel


class NarrativePatternDTO(ContractModel):
    name: str = Field(min_length=1, max_length=120)
    why: str = Field(min_length=1, max_length=600)


class NarrativeDTO(ContractModel):
    """What the person reads. Bounded: a runaway answer is rejected, not trimmed."""

    summary: str = Field(min_length=1, max_length=900)
    what_to_do: list[str] = Field(min_length=1, max_length=4)
    patterns: list[NarrativePatternDTO] = Field(max_length=3)
    recommendations: list[str] = Field(max_length=6)
    prepare: list[str] = Field(max_length=8)


class NarrativeResponseDTO(ContractModel):
    assessment_id: str
    locale: str
    # False when no AI text applies: an emergency (never AI), or a failed /
    # rejected generation. The person then reads the protocol's own wording.
    generated: bool
    narrative: NarrativeDTO | None = None
