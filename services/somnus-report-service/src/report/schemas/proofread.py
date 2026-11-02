"""Proofreading a Drive document (owner decision 2026-11-02, ADR 0019).

Mirrors packages/api-contracts/src/report/proofread.ts (the source of truth);
tests/contract checks these DTOs against the generated JSON Schema.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from report.schemas.base import ContractModel

PROOFREAD_MAX_CHARS = 4000
PROOFREAD_MAX_SUGGESTIONS = 100


class ProofreadRequestDTO(ContractModel):
    text: str = Field(min_length=1, max_length=PROOFREAD_MAX_CHARS)
    lang: Literal["es", "en", "ca", "fr"]


class ProofreadSuggestionDTO(ContractModel):
    start: int = Field(ge=0)
    end: int = Field(ge=1)
    replacement: str = Field(max_length=400)
    reason: str = Field(max_length=200)


class ProofreadResultDTO(ContractModel):
    suggestions: list[ProofreadSuggestionDTO] = Field(max_length=PROOFREAD_MAX_SUGGESTIONS)
