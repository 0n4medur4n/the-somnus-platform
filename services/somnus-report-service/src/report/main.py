"""FastAPI application factory and Cloud Run entrypoint (build plan §5.6, Phase 11).

The report service renders approved, versioned, localized reports from a
structured Morpheo payload. It never recalculates scores, alters safety flags,
or invents clinical facts (§5.6). Behavioral rules match the Python template:
binds 0.0.0.0, reads PORT from settings, structured JSON logs, correlation-ID
propagation, no production stack traces.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import timedelta
from pathlib import Path

from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker

from report.api.content_review import router as content_review_router
from report.api.corpus_admin import router as corpus_admin_router
from report.api.health import router as health_router
from report.api.reports import router as reports_router
from report.api.version import router as version_router
from report.application.content_review import ContentReviewService
from report.application.provenance import ProvenanceRecorder, ProvenanceResolver
from report.application.render_service import RenderService
from report.application.retrieval import (
    CitationResolver,
    SourceRetriever,
    VectorStoreRetriever,
)
from report.corpus.db import create_corpus_engine
from report.corpus.embedding_gate import CorpusEmbeddingGate
from report.corpus.indexer import CorpusIndexer
from report.corpus.repository import CorpusRepository, DocumentScope, ScopedDocument
from report.corpus.retrieval import CorpusRetriever
from report.infrastructure.correlation import CorrelationIdMiddleware
from report.infrastructure.db import create_engine_from_url
from report.infrastructure.errors import register_exception_handlers
from report.infrastructure.llm.openai_embedding_adapter import OpenAiEmbeddingAdapter
from report.infrastructure.logging import configure_logging
from report.infrastructure.morpheo_client import MorpheoContentClient
from report.infrastructure.pdf import WeasyPrintPdfRenderer
from report.infrastructure.sources_client import MorpheoSourcesClient
from report.infrastructure.storage import LocalStorageBackend
from report.repositories.content_review_repository import ContentReviewRepositorySql
from report.repositories.sources_repository import SourcesRepository
from report.schemas.provenance import ProvenanceDocument
from report.schemas.retrieval import CorpusEntry
from report.settings.config import Settings, load_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    configure_logging(
        service=settings.service_name,
        env=settings.env,
        version=settings.service_version,
        level=settings.log_level,
    )

    app = FastAPI(
        title="The Somnus — Report Service",
        description="Deterministic, versioned report rendering. Never recalculates results (§5.6).",
        version=settings.service_version,
        docs_url="/docs",
    )
    app.state.settings = settings
    app.state.env = settings.env

    # Lazy engine (build plan §2 cost policy: no eager pool warm-up). The clinical
    # grounding corpus (Checkpoint 11.3) lives in `somnus_reporting`; no connection
    # is opened until a query runs, so the render endpoint still boots without a DB.
    engine = create_engine_from_url(settings.database_url)
    app.state.engine = engine
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    app.state.session_factory = session_factory

    # The reference corpus (Addendum B §B3) is a SECOND logical database with its
    # own engine, user and migration history (§3.9 / §8). Lazy for the same reason
    # as the one above: the service must boot without either database reachable.
    corpus_engine = create_corpus_engine(settings.content_database_url)
    app.state.corpus_engine = corpus_engine
    corpus_session_factory = sessionmaker(bind=corpus_engine, expire_on_commit=False)
    app.state.corpus_session_factory = corpus_session_factory
    # §B3.1's read-only half: the clinical artifact's own fields, fetched from the
    # service that owns them rather than mirrored here, so the console has nothing
    # local it could write. Constructed eagerly, connects on first call only.
    app.state.corpus_sources_provider = MorpheoSourcesClient(settings.morpheo_base_url)

    # Index B (Addendum B §B3.1 / Checkpoint 16.4): supporting material for the
    # professional report, scoped to what the deterministic result activated.
    # Wired in every environment -- with no embedding key it still retrieves the
    # scoped, locale-matching set and simply cannot rank it. It reaches no
    # citation by construction: it returns GroundingMaterial, and the citation
    # path takes RetrievedSource.
    def _scoped_loader(locale: str, scopes: Sequence[DocumentScope]) -> list[ScopedDocument]:
        with corpus_session_factory() as session:
            return CorpusRepository(session).scoped_documents(locale=locale, scopes=scopes)

    corpus_retriever = CorpusRetriever(
        _scoped_loader,
        embedder=OpenAiEmbeddingAdapter(settings.openai_api_key)
        if settings.openai_api_key
        else None,
        model=settings.embedding_model,
        dimensions=settings.embedding_dimensions,
    )
    # Publishing a document embeds it (§B5 16.4), through §B4's gate and the same
    # Checkpoint 11.3 adapter. No key -> no indexer -> publish still publishes.
    app.state.corpus_indexer = (
        CorpusIndexer(
            CorpusEmbeddingGate(OpenAiEmbeddingAdapter(settings.openai_api_key)),
            model=settings.embedding_model,
            dimensions=settings.embedding_dimensions,
        )
        if settings.openai_api_key
        else None
    )

    # Checkpoint 16.5. Two halves, in two logical databases, meeting only here:
    # the record is written to `somnus_reporting` as a report is generated, and
    # the Index B documents it names are described from `somnus_content` when a
    # reviewer looks at them.
    def _current_corpus_version() -> int:
        with corpus_session_factory() as corpus_session:
            return CorpusRepository(corpus_session).current_version()

    def _live_documents(corpus_version: int) -> dict[str, ProvenanceDocument]:
        """The corpus as it was at `corpus_version` (Checkpoint 16.1's resolution).

        `documents_live_at` is reused rather than reimplemented, which is what
        makes a document retired since generation still describable: retiring
        keeps the row, so it is still live *at that version*.
        """
        with corpus_session_factory() as corpus_session:
            return {
                document.id: ProvenanceDocument(
                    document_id=document.id,
                    title=document.title,
                    citation=document.citation,
                    locale=document.locale,
                    corpus_version_added=document.corpus_version_added,
                    retired_since=document.corpus_version_retired is not None,
                )
                for document in CorpusRepository(corpus_session).documents_live_at(corpus_version)
            }

    app.state.provenance_resolver = ProvenanceResolver(_live_documents)

    # Clinical grounding (§3.6b / §14b), explanation-only. It attaches citations to
    # the professional output and can never affect the level or routing (guarded in
    # RenderService).

    def _corpus_loader(content_version: str) -> list[CorpusEntry]:
        with session_factory() as session:
            rows = SourcesRepository(session).list_version(content_version)
            return [
                CorpusEntry(
                    source_id=row.source_id,
                    citation=row.citation,
                    url=row.url,
                    vector=json.loads(row.embedding) if row.embedding else [],
                    cited_by_rules=tuple(json.loads(row.cited_by_rules or "[]")),
                )
                for row in rows
            ]

    # By id: the sources the fired rule cited. No embedder, no key, no network, so
    # §14b's guarantee holds in every environment rather than only where OpenAI is
    # configured. This is the primary path and normally the only one.
    citations = CitationResolver(_corpus_loader)

    # By similarity: the fallback, for reports that fired no rule at all. Wired
    # only when an embedding key is configured; no key -> no fallback -> those
    # reports render deterministically with no citations.
    retriever: SourceRetriever | None = None
    if settings.openai_api_key:
        retriever = VectorStoreRetriever(
            OpenAiEmbeddingAdapter(settings.openai_api_key),
            _corpus_loader,
            model=settings.embedding_model,
            dimensions=settings.embedding_dimensions,
        )

    # The render pipeline. WeasyPrint + the morpheo client are lazy (no native
    # libs loaded, no network) until a report is actually rendered, so the app
    # boots anywhere.
    # The human review queue (Checkpoint 15.3) is what can make an AI candidate
    # eligible for rendering. The render gate consults it ONLY when
    # AI_REWRITE_ENABLED is on -- which it is not, in any environment -- and can
    # ask it exactly one question: is there an APPROVED candidate for this report.
    class _ApprovedCandidates:
        def approved_candidate(self, report_id: str) -> str | None:
            with session_factory() as session:
                service = ContentReviewService(ContentReviewRepositorySql(session))
                return service.approved_candidate(report_id)

    app.state.render_service = RenderService(
        content_provider=MorpheoContentClient(settings.morpheo_base_url),
        pdf_renderer=WeasyPrintPdfRenderer(),
        storage=LocalStorageBackend(
            root=Path(settings.reports_dir), base_url=settings.report_base_url
        ),
        signed_url_ttl=timedelta(seconds=settings.signed_url_ttl_seconds),
        ai_rewrite_enabled=settings.ai_rewrite_enabled,
        citations=citations,
        retriever=retriever,
        review=_ApprovedCandidates(),
        grounding=corpus_retriever,
        provenance=ProvenanceRecorder(session_factory, _current_corpus_version),
    )

    app.add_middleware(CorrelationIdMiddleware)
    register_exception_handlers(app)

    app.include_router(health_router)
    app.include_router(version_router)
    app.include_router(reports_router)
    app.include_router(content_review_router)
    app.include_router(corpus_admin_router)

    return app


app = create_app()


def run() -> None:  # pragma: no cover - exercised via Docker/Cloud Run, not unit tests
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=app.state.settings.port, log_config=None)


if __name__ == "__main__":  # pragma: no cover
    run()
