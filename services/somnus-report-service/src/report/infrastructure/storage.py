"""Private report storage + short-lived signed URLs (build plan §9 / §5.6).

Behind a `StorageBackend` protocol. `LocalStorageBackend` is the dev/test
adapter (filesystem, never a public directory); a GCS adapter with real signing
lands for production. Objects use strict, traversal-safe keys; access is only
via a signed URL that carries an expiry (build plan §9: short-lived signed URLs,
strict object naming and expiration).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol
from urllib.parse import parse_qs, urlsplit

# reportId/locale/filename.ext — letters, digits, dot, dash, underscore, slash.
_VALID_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*$")


class StorageError(ValueError):
    """Invalid object key or a storage-access violation."""


@dataclass(frozen=True)
class SignedUrl:
    url: str
    expires_at: datetime


def _validate_key(key: str) -> None:
    if ".." in key.split("/") or not _VALID_KEY.match(key):
        raise StorageError(f"invalid object key: {key!r}")


class StorageBackend(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def signed_url(self, key: str, expires_in: timedelta) -> SignedUrl: ...


class LocalStorageBackend:
    """Filesystem storage for local/dev. Private root; the signed URL embeds an
    expiry that `is_expired` enforces (a stand-in for real GCS signing)."""

    def __init__(self, root: Path, base_url: str = "http://127.0.0.1:8081/reports") -> None:
        self._root = root
        self._base_url = base_url.rstrip("/")

    def put(self, key: str, data: bytes, content_type: str) -> None:
        _validate_key(key)
        target = self._root / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def signed_url(self, key: str, expires_in: timedelta) -> SignedUrl:
        _validate_key(key)
        expires_at = datetime.now(UTC) + expires_in
        url = f"{self._base_url}/{key}?expires={int(expires_at.timestamp())}"
        return SignedUrl(url=url, expires_at=expires_at)

    @staticmethod
    def is_expired(url: str, *, now: datetime | None = None) -> bool:
        moment = now or datetime.now(UTC)
        expires = parse_qs(urlsplit(url).query).get("expires", [])
        if not expires:
            return True
        return int(expires[0]) <= int(moment.timestamp())
