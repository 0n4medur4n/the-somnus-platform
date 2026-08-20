"""FastAPI application factory and Cloud Run entrypoint.

Reference Python service template (build plan §20 Phase 4, Checkpoint
4.1). Every future Python Cloud Run service (e.g. somnus-report-service)
clones this shell — see README.md for the cloning steps.

Behavioral rules (build plan §20 Phase 3, carried into Phase 4): binds
0.0.0.0, reads PORT from settings (default 8080), structured JSON logs,
correlation-ID propagation, no production stack traces. Graceful shutdown
is provided by uvicorn's default SIGTERM handling; there is no database
pool or other resource to drain yet at this checkpoint.
"""

from __future__ import annotations

from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker

from morpheo.api.assessment import router as assessment_router
from morpheo.api.health import router as health_router
from morpheo.api.maintenance import router as maintenance_router
from morpheo.api.sources import router as sources_router
from morpheo.api.version import router as version_router
from morpheo.infrastructure.correlation import CorrelationIdMiddleware
from morpheo.infrastructure.db import create_engine_from_url
from morpheo.infrastructure.errors import register_exception_handlers
from morpheo.infrastructure.logging import configure_logging
from morpheo.settings.config import Settings, load_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    configure_logging(
        service=settings.service_name,
        env=settings.env,
        version=settings.service_version,
        level=settings.log_level,
    )

    app = FastAPI(
        title="The Somnus — Morpheo Service",
        description="Assessment and orientation service. Deterministic rules only (§15).",
        version=settings.service_version,
        docs_url="/docs",
    )
    app.state.settings = settings
    app.state.env = settings.env

    # Lazy engine (no connection until the first query, build plan §2 cost
    # policy): the assessment endpoints get a per-request session from this.
    engine = create_engine_from_url(settings.database_url)
    app.state.engine = engine
    app.state.session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    app.add_middleware(CorrelationIdMiddleware)
    register_exception_handlers(app)

    app.include_router(health_router)
    app.include_router(version_router)
    app.include_router(assessment_router)
    app.include_router(sources_router)
    app.include_router(maintenance_router)

    return app


app = create_app()


def run() -> None:  # pragma: no cover - exercised via Docker/Cloud Run, not unit tests
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=app.state.settings.port, log_config=None)


if __name__ == "__main__":  # pragma: no cover
    run()
