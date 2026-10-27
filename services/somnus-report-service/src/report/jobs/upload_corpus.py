"""Upload the clinical-source PDFs, embed them and verify (owner decision 2026-10-27).

    python -m report.jobs.upload_corpus --source gs://<bucket>/<prefix> [--only SRC-01]
    python -m report.jobs.upload_corpus --source ./pdfs

The PDFs are read from `--source`: a Cloud Storage prefix (read with the Cloud Run
metadata token) or a local directory. Each one goes through the console's own
routes, in-process -- create the draft, upload the original, publish (which
embeds) -- so extraction, chunking, the rights gate, the indexer and the history
are exactly the ones production runs, and nothing here is a second path into the
corpus. Rights are declared `owner_authorised`: the owner's statement that The
Somnus holds permission, which asks for no licence or holder.

Safe to repeat: a document already published under the same title is verified,
not uploaded again; a draft left by an earlier failed run is finished.

Verification is part of the run, not a separate step: for every document the job
checks it is published, that the stored original is byte-identical to the file it
read, that it has chunks, and that every chunk carries a vector of the configured
model and dimensions. It prints one JSON line per document and a final summary,
and exits 1 if anything is short. It never prints the key, the database URL or
any document text.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from report.corpus.models import ReferenceDocumentChunkRow
from report.corpus.repository import CorpusRepository
from report.corpus.rights import RIGHTS_OWNER_AUTHORISED

CORPUS = "/internal/v1/admin/corpus"
#: Attributes the history to this script, not to a person (a stable 36-character id).
ACTOR = str(uuid.uuid5(uuid.NAMESPACE_URL, "https://thesomnus.com/jobs/upload_corpus"))
_METADATA_TOKEN_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
)
_OBJECT_URL = "https://storage.googleapis.com/storage/v1/b/{bucket}/o/{name}"
CHANGELOG = "Fuente clínica {src}: subida y embeddings (decisión del titular, 2026-10-27)."


@dataclass(frozen=True)
class Entry:
    file: str
    src: str
    title: str
    citation: str
    locale: str


#: The sources of v0.2 p. 15 / `morpheo_workflows_v1.json` for which we hold the PDF.
ENTRIES: tuple[Entry, ...] = (
    Entry(
        "riemann-2023-european-insomnia-guideline.pdf",
        "SRC-01",
        "The European Insomnia Guideline: An update on the diagnosis and treatment of "
        "insomnia 2023",
        "Riemann D, Espie CA, Altena E, et al. J Sleep Res. 2023. doi:10.1111/jsr.14035",
        "en",
    ),
    Entry(
        "kapur-2017-diagnostic-testing-osa.pdf",
        "SRC-02",
        "Clinical Practice Guideline for Diagnostic Testing for Adult Obstructive Sleep Apnea",
        "Kapur VK, Auckley DH, Chowdhuri S, et al. AASM. J Clin Sleep Med. 2017;13(3):479-504.",
        "en",
    ),
    Entry(
        "nice-ng202-osahs-ohs-over-16s.pdf",
        "SRC-03",
        "Obstructive sleep apnoea/hypopnoea syndrome and obesity hypoventilation syndrome "
        "in over 16s",
        "NICE guideline NG202. Published 20 August 2021.",
        "en",
    ),
    Entry(
        "nice-ng127-suspected-neurological-conditions.pdf",
        "SRC-04",
        "Suspected neurological conditions: recognition and referral",
        "NICE guideline NG127. Published 1 May 2019, last updated 2 October 2023.",
        "en",
    ),
    Entry(
        "paruthi-2016-pediatric-sleep-duration.pdf",
        "SRC-06",
        "Recommended Amount of Sleep for Pediatric Populations: consensus statement of the AASM",
        "Paruthi S, Brooks LJ, D'Ambrosio C, et al. J Clin Sleep Med. 2016;12(6):785-786.",
        "en",
    ),
    Entry(
        "kushida-2005-polysomnography-indications.pdf",
        "SRC-10",
        "Practice Parameters for the Indications for Polysomnography and Related Procedures: "
        "An Update for 2005",
        "Kushida CA, Littner MR, Morgenthaler T, et al. AASM. Sleep. 2005;28(4):499-521.",
        "en",
    ),
    Entry(
        "ses-guia-insomnio-2016.pdf",
        "SRC-14",
        "Insomnio (guía acreditada)",
        "Álamo C, Alonso ML, Cañellas F, et al. Insomnio. Miembros de la Sociedad Española "
        "del Sueño (SES). 2016.",
        "es",
    ),
)


class UploadError(RuntimeError):
    """A step of the upload was refused; the message is the route's own and safe to print."""


def _local_reader(directory: Path) -> Callable[[str], bytes]:
    def read(name: str) -> bytes:
        return (directory / name).read_bytes()

    return read


def _gcs_reader(bucket: str, prefix: str) -> Callable[[str], bytes]:
    client = httpx.Client(timeout=120.0)

    def token() -> str:
        response = client.get(
            _METADATA_TOKEN_URL, headers={"Metadata-Flavor": "Google"}, timeout=5.0
        )
        if response.status_code != 200:
            raise UploadError("no access token for the staging bucket")
        return str(response.json()["access_token"])

    def read(name: str) -> bytes:
        object_name = f"{prefix.strip('/')}/{name}" if prefix.strip("/") else name
        response = client.get(
            _OBJECT_URL.format(bucket=bucket, name=quote(object_name, safe="")),
            params={"alt": "media"},
            headers={"authorization": f"Bearer {token()}"},
        )
        if response.status_code != 200:
            raise UploadError(
                f"reading {name} from the staging bucket failed: {response.status_code}"
            )
        return response.content

    return read


def make_reader(source: str) -> Callable[[str], bytes]:
    if source.startswith("gs://"):
        bucket, _, prefix = source.removeprefix("gs://").partition("/")
        return _gcs_reader(bucket, prefix)
    return _local_reader(Path(source))


def _expect(response: Any, step: str, ok: tuple[int, ...]) -> dict[str, Any]:
    if response.status_code not in ok:
        raise UploadError(f"{step}: {response.status_code} {response.text[:300]}")
    body: dict[str, Any] = response.json()
    return body


def _existing(session: Session, title: str) -> tuple[str, str] | None:
    for document in CorpusRepository(session).search(query=title, limit=50):
        if document.title == title and document.status in ("draft", "published"):
            return document.id, document.status
    return None


def _verify(
    session: Session, document_id: str, sha256: str, *, model: str, dimensions: int
) -> dict[str, Any]:
    repository = CorpusRepository(session)
    document = repository.get(document_id)
    origin = repository.origin(document_id)
    chunks = session.scalar(
        select(func.count())
        .select_from(ReferenceDocumentChunkRow)
        .where(ReferenceDocumentChunkRow.document_id == document_id)
    )
    embedded = session.scalar(
        select(func.count())
        .select_from(ReferenceDocumentChunkRow)
        .where(
            ReferenceDocumentChunkRow.document_id == document_id,
            ReferenceDocumentChunkRow.embedding.is_not(None),
            ReferenceDocumentChunkRow.embedding_model == model,
            ReferenceDocumentChunkRow.embedding_dimensions == dimensions,
        )
    )
    first = session.scalar(
        select(ReferenceDocumentChunkRow.embedding)
        .where(ReferenceDocumentChunkRow.document_id == document_id)
        .order_by(ReferenceDocumentChunkRow.chunk_index)
        .limit(1)
    )
    first_length = len(json.loads(first)) if first else 0
    checks = {
        "published": document.status == "published",
        "original_identical": origin is not None and origin.sha256 == sha256,
        "has_chunks": bool(chunks),
        "all_chunks_embedded": bool(chunks) and chunks == embedded,
        "vector_length_ok": first_length == dimensions,
        "rights": document.rights_status == RIGHTS_OWNER_AUTHORISED,
    }
    return {
        "chunks": chunks or 0,
        "embedded": embedded or 0,
        "checks": checks,
        "ok": all(checks.values()),
    }


def run_upload(
    client: Any,
    session_factory: Callable[[], Session],
    read: Callable[[str], bytes],
    entries: tuple[Entry, ...],
    *,
    model: str,
    dimensions: int,
) -> list[dict[str, Any]]:
    """Upload and verify each entry; returns one result per entry (never raises per entry)."""
    headers = {"x-somnus-actor-id": ACTOR}
    results: list[dict[str, Any]] = []
    for entry in entries:
        result: dict[str, Any] = {"src": entry.src, "title": entry.title}
        try:
            data = read(entry.file)
            sha256 = hashlib.sha256(data).hexdigest()
            with session_factory() as session:
                found = _existing(session, entry.title)
            if found is not None and found[1] == "published":
                document_id, result["action"] = found[0], "already published"
            else:
                if found is not None:
                    document_id = found[0]
                else:
                    created = _expect(
                        client.post(
                            f"{CORPUS}/documents",
                            headers=headers,
                            json={
                                "title": entry.title,
                                "citation": entry.citation,
                                "sourceType": "guideline",
                                "locale": entry.locale,
                                "scopes": [{"scopeType": "clinical_source", "scopeKey": entry.src}],
                                "rightsStatus": RIGHTS_OWNER_AUTHORISED,
                            },
                        ),
                        "create the draft",
                        (201,),
                    )
                    document_id = str(created["id"])
                _expect(
                    client.post(
                        f"{CORPUS}/documents/{document_id}/file",
                        headers=headers,
                        json={
                            "filename": entry.file,
                            "contentBase64": base64.b64encode(data).decode("ascii"),
                        },
                    ),
                    "upload the original",
                    (200,),
                )
                _expect(
                    client.post(
                        f"{CORPUS}/documents/{document_id}/publish",
                        headers=headers,
                        json={"changelog": CHANGELOG.format(src=entry.src)},
                    ),
                    "publish and embed",
                    (200,),
                )
                result["action"] = "uploaded"
            result["document_id"] = document_id
            with session_factory() as session:
                result.update(
                    _verify(session, document_id, sha256, model=model, dimensions=dimensions)
                )
        except (UploadError, OSError, httpx.HTTPError) as error:
            result.update(ok=False, error=f"{type(error).__name__}: {error}")
        results.append(result)
    return results


def main(argv: list[str] | None = None) -> int:
    from fastapi.testclient import TestClient

    from report.main import create_app
    from report.settings.config import load_settings

    parser = argparse.ArgumentParser(description="Upload the clinical-source PDFs to the corpus.")
    parser.add_argument("--source", required=True, help="gs://bucket/prefix or a local directory")
    parser.add_argument("--only", action="append", default=[], help="an SRC id; repeatable")
    args = parser.parse_args(argv)

    settings = load_settings()
    entries = tuple(e for e in ENTRIES if not args.only or e.src in args.only)
    if not entries:
        print("[upload_corpus] no entry matches --only", file=sys.stderr)
        return 1
    app = create_app(settings)
    with TestClient(app) as client:
        if getattr(app.state, "corpus_indexer", None) is None:
            # Publishing without an indexer would publish documents with no vectors.
            print(
                "[upload_corpus] refused: no OPENAI_API_KEY, nothing was written", file=sys.stderr
            )
            return 1
        results = run_upload(
            client,
            sessionmaker(bind=app.state.corpus_engine, expire_on_commit=False),
            make_reader(args.source),
            entries,
            model=settings.embedding_model,
            dimensions=settings.embedding_dimensions,
        )
    for result in results:
        print(json.dumps(result, ensure_ascii=False))
    ok = all(result.get("ok") for result in results)
    print(
        json.dumps(
            {
                "job": "upload_corpus",
                "documents": len(results),
                "ok": ok,
                "chunks": sum(r.get("chunks", 0) for r in results),
                "embedded": sum(r.get("embedded", 0) for r in results),
            }
        )
    )
    return 0 if ok else 1


if __name__ == "__main__":  # pragma: no cover - operator entry point
    raise SystemExit(main())
