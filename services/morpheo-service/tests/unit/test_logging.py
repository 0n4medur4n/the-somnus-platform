"""Direct unit tests for JsonLogFormatter.

Exercised in isolation (a LogRecord built by hand) rather than through the
app, because pytest's own log-capture handler sits in front of ours during
integration tests and swallows the record before it reaches our handler.
"""

from __future__ import annotations

import json
import logging

from morpheo.infrastructure.logging import JsonLogFormatter


def _make_record(message: str, **extra: object) -> logging.LogRecord:
    record = logging.LogRecord(
        name="morpheo.test",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg=message,
        args=None,
        exc_info=None,
    )
    for key, value in extra.items():
        setattr(record, key, value)
    return record


def test_format_emits_the_expected_json_shape() -> None:
    formatter = JsonLogFormatter(service="morpheo-service", env="test", version="1.2.3")
    record = _make_record("something happened", correlationId="corr-1")

    payload = json.loads(formatter.format(record))

    assert payload["service"] == "morpheo-service"
    assert payload["env"] == "test"
    assert payload["version"] == "1.2.3"
    assert payload["level"] == "error"
    assert payload["message"] == "something happened"
    assert payload["correlationId"] == "corr-1"
    assert payload["timestamp"].endswith("Z")


def test_format_never_leaks_forbidden_fields() -> None:
    formatter = JsonLogFormatter(service="morpheo-service", env="test", version="1.2.3")
    record = _make_record(
        "login attempt",
        password="hunter2",
        token="abc.def.ghi",
        cookie="session=xyz",
        authorization="Bearer abc",
        secret="shh",
    )

    payload = json.loads(formatter.format(record))

    for forbidden in ("password", "token", "cookie", "authorization", "secret"):
        assert forbidden not in payload
