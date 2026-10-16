"""Service-to-service identity for calls to private Cloud Run services (ADR 0008).

Morpheo is private: Cloud Run lets a caller in only with a Google-signed ID token
for Morpheo's URL, issued to an account that holds `run.invoker` on it. On Cloud
Run (a service or a job) the token comes from the metadata server, for this
runtime's own service account -- no key, no library. Anywhere else (local
development, tests) there is no metadata server and nothing is attached: the
local Morpheo is not behind Cloud Run IAM.

Tokens last about an hour; each one is reused until five minutes before expiry.
"""

from __future__ import annotations

import os
import threading
import time
from collections.abc import Callable

import httpx

_METADATA_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity"
)
_LIFETIME_SECONDS = 55 * 60

TokenFetcher = Callable[[str], str]


def _fetch_from_metadata(audience: str) -> str:
    response = httpx.get(
        _METADATA_URL,
        params={"audience": audience, "format": "full"},
        headers={"Metadata-Flavor": "Google"},
        timeout=5.0,
    )
    response.raise_for_status()
    return response.text.strip()


def on_cloud_run() -> bool:
    """Cloud Run sets K_SERVICE in services and CLOUD_RUN_JOB in jobs."""
    return bool(os.environ.get("K_SERVICE") or os.environ.get("CLOUD_RUN_JOB"))


class IdentityHeaders:
    """`Authorization: Bearer <ID token>` for an audience, or nothing off Cloud Run."""

    def __init__(
        self, fetch: TokenFetcher = _fetch_from_metadata, enabled: bool | None = None
    ) -> None:
        self._fetch = fetch
        self._enabled = on_cloud_run() if enabled is None else enabled
        self._cache: dict[str, tuple[str, float]] = {}
        self._lock = threading.Lock()

    def __call__(self, audience: str) -> dict[str, str]:
        if not self._enabled:
            return {}
        now = time.monotonic()
        with self._lock:
            cached = self._cache.get(audience)
            if cached is None or cached[1] <= now:
                cached = (self._fetch(audience), now + _LIFETIME_SECONDS)
                self._cache[audience] = cached
        return {"Authorization": f"Bearer {cached[0]}"}
