"""Domain events (build plan §17 versioned envelope).

Interim publishers (log-based and recording), mirroring identity's approach:
a real Pub/Sub adapter replaces them later. Events never carry raw answers,
identifiers, or free text (§17) — only opaque ids and the minimal structured
data a consumer needs.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Protocol

ASSESSMENT_CREATED = "morpheo.assessment.created.v1"
ASSESSMENT_COMPLETED = "morpheo.assessment.completed.v1"
REPORT_REQUESTED = "report.generation.requested.v1"


def make_event(
    event_type: str,
    subject_id: str,
    data: dict[str, Any],
    correlation_id: str,
) -> dict[str, Any]:
    return {
        "eventId": uuid.uuid4().hex,
        "eventType": event_type,
        "occurredAt": datetime.now(UTC).isoformat(),
        "producer": "morpheo-service",
        "correlationId": correlation_id,
        # The orientation flow is anonymous (§14): there is no actor identity.
        "actor": {"type": "anonymous", "id": "anonymous"},
        "subject": {"type": "assessment", "id": subject_id},
        "data": data,
    }


class EventPublisher(Protocol):
    def publish(self, event: dict[str, Any]) -> None: ...


class RecordingEventPublisher:
    """Collects events in memory (tests)."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def publish(self, event: dict[str, Any]) -> None:
        self.events.append(event)

    def types(self) -> list[str]:
        return [event["eventType"] for event in self.events]


class LoggingEventPublisher:
    """Structured-logs the envelope until a real Pub/Sub adapter exists."""

    def __init__(self, logger: logging.Logger | None = None) -> None:
        self._logger = logger or logging.getLogger("morpheo.events")

    def publish(self, event: dict[str, Any]) -> None:
        self._logger.info(
            "event published: %s", event["eventType"], extra={"event": json.dumps(event)}
        )
