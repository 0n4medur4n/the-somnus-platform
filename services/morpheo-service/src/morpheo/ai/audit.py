"""One `ai.call` audit event per model call -- hashes and counts only.

The event says which model and prompt version ran, where (region), for what
(purpose), how it ended, and how many markers the pseudonymiser put in; the
input and output appear only as SHA-256 hashes. It never carries the person's
text, the markers' values, the session id or any account id, so the audit
trail cannot leak health data. It goes out as a structured log line
(`aiCall`), the same channel as report's generation audit.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import asdict, dataclass
from datetime import UTC, datetime

logger = logging.getLogger("morpheo.ai.audit")


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class AiCallEvent:
    event: str
    purpose: str  # "extraccion" | "cribado"
    model: str
    prompt_version: str
    region: str
    status: str  # "ok" | "timeout" | "provider_error" | "out_of_schema" | …
    input_hash: str
    output_hash: str | None
    pseudonymised_count: int
    items: int
    discarded: int
    latency_ms: int
    at: str


def build_event(
    *,
    purpose: str,
    model: str,
    prompt_version: str,
    region: str,
    status: str,
    request_fingerprint: str,
    output: str | None,
    pseudonymised_count: int,
    items: int,
    discarded: int,
    latency_ms: int,
) -> AiCallEvent:
    return AiCallEvent(
        event="ai.call",
        purpose=purpose,
        model=model,
        prompt_version=prompt_version,
        region=region,
        status=status,
        input_hash=sha256(request_fingerprint),
        output_hash=None if output is None else sha256(output),
        pseudonymised_count=pseudonymised_count,
        items=items,
        discarded=discarded,
        latency_ms=latency_ms,
        at=datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
    )


def log_event(event: AiCallEvent) -> None:
    logger.info("ai.call", extra={"aiCall": asdict(event)})


__all__ = ["AiCallEvent", "build_event", "log_event", "sha256"]
