# @somnus/api-contracts

Single source of truth for cross-service contracts. Zod 4 schemas, the
§16 API response shape, the §17 event envelope, pagination, opaque
UUIDv7 identifiers, and the supported locales. **Zero business logic.**

## What lives here

- `ApiErrorResponseSchema` / `buildApiErrorResponse` — every API error
  has the same shape; the frontend maps the `code` through i18n.
- `PaginationQuerySchema`, `PageInfoSchema`, `CursorSchema` — the
  cursor-based pagination used by all list endpoints.
- `UUIDv7`, `isUUIDv7`, `parseOpaqueId`, `opaqueIdSchema` — opaque
  identifiers per build plan §12. Sequential DB ids are never exposed.
- `EventEnvelopeSchema`, `makeEvent`, `KNOWN_EVENT_TYPES`,
  `isProducer` — the versioned event envelope from build plan §17.
  Producers and consumers agree on the eventType string.
- `LocaleSchema`, `SUPPORTED_LOCALES`, `DEFAULT_LOCALE` — the four
  locales from build plan §3.3.

## What does NOT live here

- Business rules.
- Database access.
- HTTP transport details (those live in the services).
- Authorization decisions (those live in `somnus-identity-service`).
- Anything that imports from `services/`.

## Build plan

Implements build plan §20 Phase 2 / Checkpoint 2.2.
