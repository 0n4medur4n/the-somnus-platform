import { randomUUID } from "node:crypto";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { SessionRecord } from "../modules/sessions/session.service.js";

/**
 * Behind `SessionGuard` a session is always present; this narrows the
 * `@CurrentSession()` type and fails closed (UNAUTHENTICATED) rather
 * than dereferencing undefined if a route is ever mounted without the
 * guard.
 */
export function requireSession(
  session: SessionRecord | undefined,
  correlationId: string,
): SessionRecord {
  if (!session) {
    throw new SomnusError(ErrorCode.UNAUTHENTICATED, "Authentication is required.", {
      correlationId,
    });
  }
  return session;
}

/**
 * The correlation id set by CorrelationInterceptor, or a fresh one if
 * (defensively) none is present, so every downstream call is traceable.
 */
export function correlationOf(correlationId: string | undefined): string {
  return correlationId ?? randomUUID();
}
