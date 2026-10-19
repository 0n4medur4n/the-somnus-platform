import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { loadEdgeConfig } from "../../config/edge-config.js";
import type { RequestWithSession } from "./current-session.decorator.js";
import { SessionService } from "./session.service.js";

/**
 * For routes open to everyone that do something more for a signed-in person
 * (the v2 interview: theirs from the start; the team panel for staff). Reads
 * and validates the session cookie exactly like `SessionGuard`, attaches the
 * session when it is valid, and never rejects: a missing, tampered, revoked
 * or expired cookie simply means "anonymous".
 */
@Injectable()
export class OptionalSessionGuard implements CanActivate {
  private readonly cookieName = loadEdgeConfig(process.env).SESSION_COOKIE_NAME;

  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithSession>();
    const raw = req.cookies?.[this.cookieName];
    if (!raw) return true;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || unsigned.value === null) return true;
    const session = await this.sessions.validate(unsigned.value);
    if (session) req.session = session;
    return true;
  }
}
