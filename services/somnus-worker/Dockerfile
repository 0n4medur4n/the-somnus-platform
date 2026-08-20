# syntax=docker/dockerfile:1.7
# Multi-stage, non-root, slim image for somnus-worker.
# The build plan §3.4 pins Node 24 LTS.

# ---- 1. build (deps, build, install all in one stage so the
#        pnpm-workspace symlinks resolve correctly) ----
FROM node:24-alpine AS build
WORKDIR /app/services/somnus-worker
RUN apk add --no-cache libc6-compat
RUN corepack enable
# pnpm-workspace and root package.json must be visible because pnpm
# resolves the workspace from the package being installed.
COPY pnpm-workspace.yaml package.json /app/
COPY packages /app/packages
COPY services/somnus-worker ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile=false --config.dangerouslyAllowAllBuilds=true --filter @somnus/worker...
RUN pnpm exec nest build

# ---- 2. runtime ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    SERVICE_NAME=somnus-worker
RUN addgroup -S somnus && adduser -S somnus -G somnus
WORKDIR /app/services/somnus-worker
COPY --from=build --chown=somnus:somnus /app/services/somnus-worker/dist ./dist
COPY --from=build --chown=somnus:somnus /app/services/somnus-worker/node_modules ./node_modules
COPY --from=build --chown=somnus:somnus /app/node_modules /app/node_modules
COPY --from=build --chown=somnus:somnus /app/packages /app/packages
USER somnus
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/health/live || exit 1
CMD ["node", "dist/main.js"]
