"""Service build info endpoint."""

from __future__ import annotations

import platform

from fastapi import APIRouter, Request

router = APIRouter(prefix="/version", tags=["version"])


@router.get("", summary="Service build info (service, version, commit, env, python).")
async def version(request: Request) -> dict[str, str]:
    settings = request.app.state.settings
    return {
        "service": settings.service_name,
        "version": settings.service_version,
        "commit": settings.service_commit,
        "env": settings.env,
        "python": platform.python_version(),
    }
