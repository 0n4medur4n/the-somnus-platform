"""Translating what is read aloud (owner decision 2026-11-03, ADR 0019).

Mirrors packages/api-contracts/src/report/translate.ts (the source of truth);
tests/contract checks these DTOs against the generated JSON Schema.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from report.schemas.base import ContractModel

TRANSLATE_MAX_PASSAGES = 12
TRANSLATE_MAX_CHARS = 4000


class TranslateRequestDTO(ContractModel):
    passages: list[str] = Field(min_length=1, max_length=TRANSLATE_MAX_PASSAGES)
    lang: Literal["es", "en", "ca", "fr"]

    @field_validator("passages")
    @classmethod
    def _within_limits(cls, passages: list[str]) -> list[str]:
        if any(not 1 <= len(p) <= 600 for p in passages):
            raise ValueError("Each passage has 1 to 600 characters.")
        if sum(len(p) for p in passages) > TRANSLATE_MAX_CHARS:
            raise ValueError(f"At most {TRANSLATE_MAX_CHARS} characters in all.")
        return passages


class TranslateResultDTO(ContractModel):
    passages: list[str] = Field(max_length=TRANSLATE_MAX_PASSAGES)
