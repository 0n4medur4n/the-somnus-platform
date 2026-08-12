# syntax=docker/dockerfile:1.7
# Multi-stage, non-root, slim image for morpheo-service.
# The build plan §3.5 pins Python 3.13; §18 rejects prerelease dependencies.

# ---- 1. build (resolve + install with uv, non-editable) ----
FROM python:3.13-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.26 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app/services/morpheo-service

# Dependencies first (better layer caching): this layer only invalidates
# when pyproject.toml / uv.lock change, not on every source edit.
COPY services/morpheo-service/pyproject.toml services/morpheo-service/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project --no-dev --no-editable

# Now the project itself, installed non-editable so the runtime stage
# only needs the resulting .venv, not the original source tree.
COPY services/morpheo-service/src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

# ---- 2. runtime ----
FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/services/morpheo-service/.venv/bin:$PATH" \
    PORT=8080 \
    ENV=production \
    SERVICE_NAME=morpheo-service
RUN groupadd --system somnus && useradd --system --gid somnus --no-create-home somnus
WORKDIR /app/services/morpheo-service
COPY --from=build --chown=somnus:somnus /app/services/morpheo-service/.venv ./.venv
# Alembic config + migrations are bundled for operational use (e.g. a
# one-off `alembic upgrade head` job); the service itself does not run
# migrations at boot.
COPY --chown=somnus:somnus services/morpheo-service/alembic.ini ./
COPY --chown=somnus:somnus services/morpheo-service/migrations ./migrations
USER somnus
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health/live', timeout=2)" || exit 1
CMD ["python", "-m", "morpheo.main"]
