# The Somnus — developer command palette.
# Requires: just (https://github.com/casey/just). Install via:
#   winget install Casey.Just
# All recipes delegate to pnpm; do not duplicate logic in npm scripts.

set shell := ["powershell.exe", "-NoProfile", "-Command"]
set dotenv-load := true

# Default recipe: list available commands.
default:
    @just --list

# --- Local dev stack ---

# Start the local docker-compose stack (MySQL 8 + Firebase emulators).
dev-up:
    docker compose -f docker-compose.dev.yml up -d
    @echo "Stack started. MySQL on 3306, Firebase UI on http://localhost:4000"

# Stop the local docker-compose stack.
dev-down:
    docker compose -f docker-compose.dev.yml down

# Tail logs from the dev stack.
dev-logs:
    docker compose -f docker-compose.dev.yml logs -f

# --- Quality gate ---

# Run the full quality gate: format check, lint, typecheck, tests, build.
ci: check typecheck test build

# Biome format check (does not modify files).
check:
    pnpm run check

# Biome lint only.
lint:
    pnpm run lint

# TypeScript strict typecheck.
typecheck:
    pnpm run typecheck

# Vitest in watch mode.
test:
    pnpm run test

# Vitest single run.
test-run:
    pnpm run test:run

# Vitest with coverage.
test-coverage:
    pnpm run test:coverage

# Build root scripts (no services build at Phase 1.1).
build:
    pnpm run build

# --- Seeding ---

# Reset and seed the local dev database. At Phase 1.1 there is no seed data
# yet; this recipe is a placeholder so subsequent checkpoints can attach to it.
seed:
    @echo "No seed defined at Phase 1.1. See THE_SOMNUS_PLATFORM_BUILD_PLAN.md §8 for the eventual deterministic dev dataset."
