"""Private storage + signed-URL expiry (build plan §9 / §20 Checkpoint 11.1)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from report.infrastructure.storage import LocalStorageBackend, StorageError


def test_put_writes_a_private_file(tmp_path: Path) -> None:
    backend = LocalStorageBackend(root=tmp_path)
    backend.put("rep-1/es/report.html", b"<html></html>", "text/html")
    assert (tmp_path / "rep-1" / "es" / "report.html").read_bytes() == b"<html></html>"


def test_signed_url_carries_a_future_expiry(tmp_path: Path) -> None:
    backend = LocalStorageBackend(root=tmp_path)
    signed = backend.signed_url("rep-1/es/report.pdf", timedelta(hours=1))
    assert "expires=" in signed.url
    assert signed.expires_at > datetime.now(UTC)
    assert LocalStorageBackend.is_expired(signed.url) is False


def test_expired_url_is_detected(tmp_path: Path) -> None:
    backend = LocalStorageBackend(root=tmp_path)
    signed = backend.signed_url("rep-1/es/report.pdf", timedelta(hours=1))
    later = datetime.now(UTC) + timedelta(hours=2)
    assert LocalStorageBackend.is_expired(signed.url, now=later) is True
    assert LocalStorageBackend.is_expired("http://x/y/z") is True  # no expiry -> treated expired


@pytest.mark.parametrize("bad_key", ["../etc/passwd", "/abs/path", "a//b", "a/../b", ""])
def test_strict_object_keys_reject_traversal(tmp_path: Path, bad_key: str) -> None:
    backend = LocalStorageBackend(root=tmp_path)
    with pytest.raises(StorageError):
        backend.put(bad_key, b"x", "text/plain")
    with pytest.raises(StorageError):
        backend.signed_url(bad_key, timedelta(hours=1))
