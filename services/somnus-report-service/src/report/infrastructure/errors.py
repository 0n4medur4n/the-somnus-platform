"""Unhandled-exception mapping.

No production stack trace ever reaches the response body; the client always
receives the §16 error envelope. The real exception is logged server-side
(message only, no traceback, no health data). Mirrors the morpheo template.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from report.infrastructure.correlation import CORRELATION_ID_HEADER

logger = logging.getLogger("report.errors")


def _public_message(exc: Exception, env: str) -> str:
    """Full exception text outside production; a generic message in it."""
    return str(exc) if env != "production" else "An unexpected error occurred."


def build_error_body(*, code: str, message: str, correlation_id: str) -> dict[str, object]:
    """The build plan §16 error response shape."""
    return {
        "error": {
            "code": code,
            "message": message,
            "correlationId": correlation_id,
            "details": {},
        }
    }


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    correlation_id = getattr(request.state, "correlation_id", "unknown")
    logger.error(str(exc), extra={"correlationId": correlation_id, "errorType": type(exc).__name__})

    env = getattr(request.app.state, "env", "production")
    body = build_error_body(
        code="INTERNAL",
        message=_public_message(exc, env),
        correlation_id=correlation_id,
    )
    return JSONResponse(
        status_code=500,
        content=body,
        headers={CORRELATION_ID_HEADER: correlation_id},
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(Exception, unhandled_exception_handler)
