"""Where uploaded corpus originals are kept (owner decision 2026-10-18).

One private Cloud Storage bucket owned by the corpus module, reached with the
service's own identity through the JSON API -- no client library, no signed URL:
the console downloads a file through edge-api, which asks this service, so the
bucket never needs to be readable by anything but this service account.

`LocalCorpusFileStore` is the development and test adapter: a private directory.
"""

from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Final, Protocol
from urllib.parse import quote

import httpx

_METADATA_TOKEN_URL: Final = (
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
)
_UPLOAD_URL: Final = "https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o"
_OBJECT_URL: Final = "https://storage.googleapis.com/storage/v1/b/{bucket}/o/{name}"
# documents/<uuid>/<sha256>.<ext>
_VALID_NAME: Final = re.compile(r"^documents/[0-9a-f-]{36}/[0-9a-f]{64}\.(pdf|docx)$")


class CorpusFileStoreError(RuntimeError):
    """The original could not be stored or read."""


def object_name(document_id: str, sha256: str, extension: str) -> str:
    name = f"documents/{document_id}/{sha256}.{extension}"
    if not _VALID_NAME.match(name):
        raise CorpusFileStoreError("invalid corpus object name")
    return name


class CorpusFileStore(Protocol):
    def put(self, name: str, data: bytes, content_type: str) -> None: ...
    def get(self, name: str) -> bytes: ...


class LocalCorpusFileStore:
    def __init__(self, root: Path) -> None:
        self._root = root

    def _path(self, name: str) -> Path:
        if not _VALID_NAME.match(name):
            raise CorpusFileStoreError("invalid corpus object name")
        return self._root / name

    def put(self, name: str, data: bytes, content_type: str) -> None:
        target = self._path(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def get(self, name: str) -> bytes:
        target = self._path(name)
        if not target.is_file():
            raise CorpusFileStoreError("the stored original is missing")
        return target.read_bytes()


class GcsCorpusFileStore:
    """The bucket, with an access token from the Cloud Run metadata server."""

    def __init__(self, bucket: str, *, client: httpx.Client | None = None) -> None:
        self._bucket = bucket
        self._client = client or httpx.Client(timeout=60.0)
        self._token: tuple[str, float] | None = None

    def _access_token(self) -> str:
        if self._token is not None and self._token[1] > time.monotonic() + 60:
            return self._token[0]
        response = self._client.get(
            _METADATA_TOKEN_URL, headers={"Metadata-Flavor": "Google"}, timeout=5.0
        )
        if response.status_code != 200:
            raise CorpusFileStoreError("no access token for the corpus bucket")
        body = response.json()
        self._token = (str(body["access_token"]), time.monotonic() + float(body["expires_in"]))
        return self._token[0]

    def put(self, name: str, data: bytes, content_type: str) -> None:
        if not _VALID_NAME.match(name):
            raise CorpusFileStoreError("invalid corpus object name")
        response = self._client.post(
            _UPLOAD_URL.format(bucket=self._bucket),
            params={"uploadType": "media", "name": name},
            headers={
                "authorization": f"Bearer {self._access_token()}",
                "content-type": content_type,
            },
            content=data,
        )
        if response.status_code not in (200, 201):
            # Status only: the error body can echo the request.
            raise CorpusFileStoreError(f"storing the original failed: {response.status_code}")

    def get(self, name: str) -> bytes:
        if not _VALID_NAME.match(name):
            raise CorpusFileStoreError("invalid corpus object name")
        response = self._client.get(
            _OBJECT_URL.format(bucket=self._bucket, name=quote(name, safe="")),
            params={"alt": "media"},
            headers={"authorization": f"Bearer {self._access_token()}"},
        )
        if response.status_code == 404:
            raise CorpusFileStoreError("the stored original is missing")
        if response.status_code != 200:
            raise CorpusFileStoreError(f"reading the original failed: {response.status_code}")
        return response.content


def create_corpus_file_store(bucket: str, local_dir: str) -> CorpusFileStore:
    return GcsCorpusFileStore(bucket) if bucket else LocalCorpusFileStore(Path(local_dir))
