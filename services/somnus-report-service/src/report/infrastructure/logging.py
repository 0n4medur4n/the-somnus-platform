"""Structured JSON logging.

Mirrors packages/observability + the morpheo template (build plan §20 Checkpoint
2.1) so operators see one consistent line format across the fleet. Never logs
passwords, tokens, cookies, health data, or report content (build plan §19 /
§21). A small denylist strips obviously-forbidden field names as defense in depth.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

from report.settings.config import LogLevel

_RESERVED_LOGRECORD_FIELDS = frozenset(
    {
        "name",
        "msg",
        "args",
        "levelname",
        "levelno",
        "pathname",
        "filename",
        "module",
        "exc_info",
        "exc_text",
        "stack_info",
        "lineno",
        "funcName",
        "created",
        "msecs",
        "relativeCreated",
        "thread",
        "threadName",
        "processName",
        "process",
        "message",
        "taskName",
    }
)

_FORBIDDEN_FIELD_NAMES = ("password", "token", "cookie", "authorization", "secret")

_LEVEL_MAP: dict[LogLevel, int] = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "error": logging.ERROR,
}


class JsonLogFormatter(logging.Formatter):
    """Renders one JSON object per log line."""

    def __init__(self, *, service: str, env: str, version: str) -> None:
        super().__init__()
        self._service = service
        self._env = env
        self._version = version

    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.fromtimestamp(record.created, tz=UTC).isoformat(
            timespec="milliseconds"
        )
        payload: dict[str, Any] = {
            "timestamp": timestamp.replace("+00:00", "Z"),
            "level": record.levelname.lower(),
            "service": self._service,
            "env": self._env,
            "version": self._version,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED_LOGRECORD_FIELDS and not key.startswith("_"):
                payload[key] = value
        for forbidden in _FORBIDDEN_FIELD_NAMES:
            payload.pop(forbidden, None)
        return json.dumps(payload, default=str)


def configure_logging(*, service: str, env: str, version: str, level: LogLevel) -> None:
    """Replaces the root logger's handlers with a single JSON stdout handler."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonLogFormatter(service=service, env=env, version=version))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(_LEVEL_MAP[level])
