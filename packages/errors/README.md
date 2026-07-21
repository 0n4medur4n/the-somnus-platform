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

## Build plan

Implements build plan §16 (API error shape) and §20 Phase 2 / Checkpoint
2.1.
