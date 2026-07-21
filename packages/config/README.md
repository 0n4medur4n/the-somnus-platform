# @somnus/config

Zod-validated, fail-fast environment configuration for every Somnus
service. The single source of truth for environment shape.

## Why

A service that boots with a malformed `DATABASE_URL` should not serve
traffic. Validation happens **before** the HTTP listener opens, in
strict TypeScript, with helpful error messages, and with a hard
`process.exit(1)` if anything is wrong.

## Public vs private

- `config.public` — values safe to surface to the client (e.g. the
  default locale, the app base URL).
- `config.private` — everything else (database URLs, secrets, etc).
  Never log this section in full; `packages/observability` redacts it.

## Usage

```ts
import { loadConfig } from "@somnus/config";

export const config = loadConfig({ serviceName: "somnus-identity-service" });
// config.public.DEFAULT_LOCALE
// config.private.PORT
// config.service.env
```

## Build plan

Implements build plan §20 Phase 2 / Checkpoint 2.1. No business logic,
no imports from `services/`.
