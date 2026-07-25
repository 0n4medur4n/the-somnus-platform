import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { loadEdgeConfig } from "../../config/edge-config.js";
import type { RequestWithSession } from "./current-session.decorator.js";
import { SessionService } from "./session.service.js";

/**
 * Guards routes that require an authenticated session. Reads the
 * signed, HttpOnly session cookie, unsigns it (rejecting a tampered
 * signature), then validates the session id against the server-side
 * store -- so a revoked or expired session is rejected here, on the
 * very next request, with no dependency on Firebase token revocation.
 *
 * On success attaches the SessionRecord to the request for
 * `@CurrentSession()`. On any failure throws UNAUTHENTICATED (401),
 * never leaking why (missing vs. tampered vs. revoked vs. expired all
 * look identical to a caller).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly cookieName = loadEdgeConfig(process.env).SESSION_COOKIE_NAME;

  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<RequestWithSession & { correlationId?: string }>();
    const correlationId = req.correlationId ?? "sessions";
    const raw = req.cookies?.[this.cookieName];
    if (!raw) throw this.unauthenticated(correlationId);

    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || unsigned.value === null) throw this.unauthenticated(correlationId);

    const session = await this.sessions.validate(unsigned.value);
    if (!session) throw this.unauthenticated(correlationId);

    req.session = session;
    return true;
  }

  private unauthenticated(correlationId: string): SomnusError {
    return new SomnusError(ErrorCode.UNAUTHENTICATED, "Authentication is required.", {
      correlationId,
    });
  }
}
