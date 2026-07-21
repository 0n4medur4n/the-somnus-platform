# syntax=docker/dockerfile:1.7
# Multi-stage, non-root, slim image for somnus-identity-service.
# The build plan §3.4 pins Node 24 LTS.

# ---- 1. build (deps, build, install all in one stage so the
#        pnpm-workspace symlinks resolve correctly) ----
FROM node:24-alpine AS build
WORKDIR /app/services/somnus-identity-service
RUN apk add --no-cache libc6-compat
RUN corepack enable
# pnpm-workspace and root package.json must be visible because pnpm
# resolves the workspace from the package being installed.
COPY pnpm-workspace.yaml package.json /app/
COPY packages /app/packages
COPY services/somnus-identity-service ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile=false --config.dangerouslyAllowAllBuilds=true --filter @somnus/identity-service...
RUN pnpm exec nest build

# ---- 2. runtime ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    SERVICE_NAME=somnus-identity-service
RUN addgroup -S somnus && adduser -S somnus -G somnus
# Keep the same WORKDIR as the build stage so the pnpm-workspace
# symlinks continue to resolve at runtime. The dist + node_modules
# are already in the right places.
WORKDIR /app/services/somnus-identity-service
COPY --from=build --chown=somnus:somnus /app/services/somnus-identity-service/dist ./dist
COPY --from=build --chown=somnus:somnus /app/services/somnus-identity-service/node_modules ./node_modules
# pnpm-workspace places transitive deps in a virtual store at
# /app/node_modules/.pnpm/ that the top-level symlinks resolve to.
COPY --from=build --chown=somnus:somnus /app/node_modules /app/node_modules
# The @somnus/* symlinks in node_modules resolve with four ".."
# segments to /app/packages/<name>. We must copy the packages tree
# at exactly that absolute path for the symlinks to resolve.
COPY --from=build --chown=somnus:somnus /app/packages /app/packages
USER somnus
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/health/live || exit 1
CMD ["node", "dist/main.js"]
