"""FastAPI application factory and Cloud Run entrypoint (build plan §5.6, Phase 11).

The report service renders approved, versioned, localized reports from a
structured Morpheo payload. It never recalculates scores, alters safety flags,
or invents clinical facts (§5.6). Behavioral rules match the Python template:
binds 0.0.0.0, reads PORT from settings, structured JSON logs, correlation-ID
propagation, no production stack traces.
"""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

from fastapi import FastAPI

from report.api.health import router as health_router
from report.api.reports import router as reports_router
from report.api.version import router as version_router
from report.application.render_service import RenderService
from report.infrastructure.correlation import CorrelationIdMiddleware
from report.infrastructure.errors import register_exception_handlers
from report.infrastructure.logging import configure_logging
from report.infrastructure.morpheo_client import MorpheoContentClient
from report.infrastructure.pdf import WeasyPrintPdfRenderer
from report.infrastructure.storage import LocalStorageBackend
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

    # The render pipeline. WeasyPrint + the morpheo client are lazy (no native
    # libs loaded, no network) until a report is actually rendered, so the app
    # boots anywhere.
    app.state.render_service = RenderService(
        content_provider=MorpheoContentClient(settings.morpheo_base_url),
        pdf_renderer=WeasyPrintPdfRenderer(),
        storage=LocalStorageBackend(
            root=Path(settings.reports_dir), base_url=settings.report_base_url
        ),
        signed_url_ttl=timedelta(seconds=settings.signed_url_ttl_seconds),
    )

    app.add_middleware(CorrelationIdMiddleware)
    register_exception_handlers(app)

    app.include_router(health_router)
    app.include_router(version_router)
    app.include_router(reports_router)

    return app


app = create_app()


def run() -> None:  # pragma: no cover - exercised via Docker/Cloud Run, not unit tests
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=app.state.settings.port, log_config=None)


if __name__ == "__main__":  # pragma: no cover
    run()
