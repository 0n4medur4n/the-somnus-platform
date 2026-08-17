"""Liveness/readiness probes (build plan §20; same behavior as the template)."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live", summary="Liveness probe. Always 200 if the process is up.")
async def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready", summary="Readiness probe. 200 when ready to serve traffic.")
async def ready() -> dict[str, str]:
    return {"status": "ready"}
