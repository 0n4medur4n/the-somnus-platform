"""Retention/cleanup DTOs (build plan §20 Checkpoint 12.2).

The worker's scheduled jobs call these to purge unclaimed assessments (30-day TTL)
and expired claim tokens (72 h). Morpheo only deletes rows older than the cutoff
the worker computes; it holds no schedule of its own.
"""

from __future__ import annotations

from datetime import datetime

from morpheo.schemas.base import ContractModel


class MaintenanceDeleteRequestDTO(ContractModel):
    before: datetime


class MaintenanceDeleteResultDTO(ContractModel):
    deleted: int
