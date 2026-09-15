"""Index the clinical-source corpus: the explicit entry point (Checkpoint 16.0).

    python -m report.jobs.index_sources

The only way `SourceIndexer` runs. Until Checkpoint 16.0 nothing invoked it at
all — the class existed, was tested, and had no entry point, so the runbook step
"re-run the indexer" pointed at nothing.

**Never on boot, never automatic** (Addendum B §B2a.1). Minimum instances are zero
everywhere (build plan §2), so the service boots constantly; indexing on boot would
hit the OpenAI API on every cold start and make the index depend on which instance
happened to start when. This module is therefore not imported by `report.main` or
by anything under `report.api`, and `test_index_sources_job.py` asserts that
structurally. It runs as a deploy step, by hand, after a `content_version` bump.

Safe to repeat. An unchanged corpus makes no embedding call and writes nothing,
so running it twice is a no-op, not a second bill. The OpenAI key is only needed
when something actually has to be embedded: without one, an unchanged re-run still
succeeds, and a run that needs vectors fails before writing anything.

Prints one JSON line of counts on success. Never prints the key, the database URL
or any source text.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from dataclasses import asdict

from sqlalchemy.orm import Session, sessionmaker

from report.application.source_indexer import IndexResult, SourceIndexer
from report.infrastructure.db import create_engine_from_url
from report.infrastructure.llm.openai_embedding_adapter import OpenAiEmbeddingAdapter
from report.infrastructure.llm.provider import (
    EmbeddingProvider,
    EmbeddingRequest,
    EmbeddingResponse,
)
from report.infrastructure.sources_client import MorpheoSourcesClient, SourcesProvider
from report.repositories.sources_repository import SourcesRepository
from report.settings.config import Settings, load_settings


class EmbeddingNotConfiguredError(RuntimeError):
    """Something needs embedding and no embedding key is configured."""


class UnconfiguredEmbedder:
    """Stands in for the adapter when `OPENAI_API_KEY` is unset.

    Raises only if it is actually asked to embed, which the indexer does only after
    it has established that some source has no stored vector it can use. So an
    unchanged re-run needs no key, and a run that does need one fails before any
    write — never halfway through.
    """

    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        raise EmbeddingNotConfiguredError(
            f"{len(request.inputs)} clinical source(s) need embedding and OPENAI_API_KEY "
            "is not set; nothing was written"
        )


def build_embedder(settings: Settings) -> EmbeddingProvider:
    if settings.openai_api_key:
        return OpenAiEmbeddingAdapter(settings.openai_api_key)
    return UnconfiguredEmbedder()


def run_index(
    *,
    settings: Settings,
    provider: SourcesProvider,
    embedder: EmbeddingProvider,
    session_factory: Callable[[], Session],
) -> IndexResult:
    """One indexing run, in one transaction: it commits whole or not at all."""
    with session_factory() as session:
        try:
            result = SourceIndexer(
                provider,
                embedder,
                SourcesRepository(session),
                model=settings.embedding_model,
                dimensions=settings.embedding_dimensions,
            ).index()
            session.commit()
        except BaseException:
            session.rollback()
            raise
    return result


def main() -> int:
    settings = load_settings()
    engine = create_engine_from_url(settings.database_url)
    try:
        result = run_index(
            settings=settings,
            provider=MorpheoSourcesClient(settings.morpheo_base_url),
            embedder=build_embedder(settings),
            session_factory=sessionmaker(bind=engine, expire_on_commit=False),
        )
    except Exception as exc:
        # The exception's message, not its repr and not a traceback of locals:
        # every message raised on this path is written to be safe to print.
        print(f"[index_sources] refused: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        engine.dispose()
    print(json.dumps({"job": "index_sources", **asdict(result)}))
    return 0


if __name__ == "__main__":  # pragma: no cover - operator entry point
    raise SystemExit(main())
