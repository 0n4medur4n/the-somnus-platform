# @somnus/errors

Stable error codes, the §16 HTTP response shape, and the internal log
shape for the whole platform. The `SomnusError` class carries the
information needed to produce either shape.

## Why

A 401 from the edge API must always carry the same
`UNAUTHENTICATED` code regardless of which downstream service raised
it. The frontend maps the code through i18n to a user-facing message,
so the message in the body is intentionally generic and stable.

## Usage

```ts
import { SomnusError, ErrorCode, toHttpResponse } from "@somnus/errors";

throw new SomnusError(ErrorCode.NOT_FOUND, "membership not found", {
  correlationId: req.id,
  details: { organizationId, membershipId },
});

return reply.status(errorCodeToHttpStatus[code]).send(toHttpResponse(code, req.id));
```

## Adding an error code

Add it in **one** place: `ErrorCode`, `errorCodeToHttpStatus` and
`SAFE_PUBLIC_MESSAGES` in `src/codes.ts`. Every service picks it up from there.

**Exception filters never maintain their own code→HTTP-status map.** They import
`errorCodeToHttpStatus` from this package and fall back to 500 for anything
genuinely unmapped:

```ts
function errorCodeToStatus(code: ErrorCodeType): number {
  return errorCodeToHttpStatus[code] ?? 500;
}
```

This is not a style preference. All three Nest services once carried a
hand-written copy of that table, and the copies did not fail loudly when they
fell behind — the four `INVITATION_*` codes added in Checkpoint 14.2 were
returned as **500** by every service until the duplicates were collapsed onto
this one. A duplicated mapping degrades silently; a missing entry here does not,
because there is only one.

## Build plan

Implements build plan §16 (API error shape) and §20 Phase 2 / Checkpoint
2.1.
