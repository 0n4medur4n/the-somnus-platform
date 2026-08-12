"""Liveness/readiness probes. Mirrors HealthController in the NestJS template
(services/somnus-identity-service), carrying the same behavior into Phase 4.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live", summary="Liveness probe. Always 200 if the process is up.")
async def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready", summary="Readiness probe. 200 when ready to serve traffic.")
async def ready() -> dict[str, str]:
    # No external dependencies are checked yet (no assessment logic in this
    # checkpoint). Phase 10.2 adds a database-connectivity check here.
    return {"status": "ready"}
