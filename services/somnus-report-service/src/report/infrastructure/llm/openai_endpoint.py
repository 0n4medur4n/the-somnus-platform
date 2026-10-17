"""Which OpenAI API endpoint this service talks to, stated once.

Where OpenAI processes a request depends on the endpoint: the default
`https://api.openai.com/v1` is processed in the US; an EU data-residency
project uses `https://eu.api.openai.com/v1`. The adapters build their client
with this URL and the service logs it at startup, so what the logs say is what
the calls use. It mirrors the SDK's own rule (OPENAI_BASE_URL, else the default)
and is not a secret.
"""

from __future__ import annotations

import logging
import os

DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"

logger = logging.getLogger("report.llm")


def openai_base_url() -> str:
    return os.environ.get("OPENAI_BASE_URL") or DEFAULT_OPENAI_BASE_URL


def endpoint_line(*, enabled: bool) -> str:
    if enabled:
        return f"OpenAI API base URL in use: {openai_base_url()}"
    return "OpenAI not configured (no OPENAI_API_KEY): no model calls"


def log_openai_endpoint(*, enabled: bool) -> None:
    """The startup line: the endpoint in use, or that OpenAI is not configured."""
    logger.info(endpoint_line(enabled=enabled))
