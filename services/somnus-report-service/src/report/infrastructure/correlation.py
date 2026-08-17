"""Correlation-ID propagation middleware.

Mirrors morpheo-service / somnus-identity-service: validates the incoming
`x-correlation-id`, falls back to a fresh id when missing or malformed, stores
it on `request.state` for handlers/logging, and echoes it back on the response.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

CORRELATION_ID_HEADER = "x-correlation-id"
_VALID_CORRELATION_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get(CORRELATION_ID_HEADER)
        correlation_id = (
            incoming
            if incoming is not None and _VALID_CORRELATION_ID.match(incoming)
            else str(uuid.uuid4())
        )
        request.state.correlation_id = correlation_id
        response = await call_next(request)
        response.headers[CORRELATION_ID_HEADER] = correlation_id
        return response
