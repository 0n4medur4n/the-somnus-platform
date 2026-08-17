# syntax=docker/dockerfile:1.7
# Multi-stage, non-root, slim image for somnus-report-service.
# The build plan §3.5 pins Python 3.13; §18 rejects prerelease dependencies.

# ---- 1. build (resolve + install with uv, non-editable) ----
FROM python:3.13-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.26 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app/services/somnus-report-service

# Dependencies first for better layer caching.
COPY services/somnus-report-service/pyproject.toml services/somnus-report-service/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project --no-dev --no-editable

COPY services/somnus-report-service/src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

# ---- 2. runtime ----
FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/services/somnus-report-service/.venv/bin:$PATH" \
    PORT=8080 \
    ENV=production \
    SERVICE_NAME=somnus-report-service
RUN groupadd --system somnus && useradd --system --gid somnus --no-create-home somnus
WORKDIR /app/services/somnus-report-service
COPY --from=build --chown=somnus:somnus /app/services/somnus-report-service/.venv ./.venv
USER somnus
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health/live', timeout=2)" || exit 1
CMD ["python", "-m", "report.main"]
