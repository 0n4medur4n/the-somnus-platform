import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

/**
 * Guards internal service-to-service endpoints (audit ingest, scheduled-job
 * triggers). The worker is a private Cloud Run service; in staging/production the
 * caller (Pub/Sub push, Cloud Scheduler) presents a bearer token checked here.
 * Locally INTERNAL_AUTH_TOKEN is unset and the guard is a no-op; the full OIDC
 * verification hardening lands with the deploy work (§21 / Phase 13).
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  private readonly expected = process.env["INTERNAL_AUTH_TOKEN"] ?? "";

  canActivate(context: ExecutionContext): boolean {
    if (this.expected === "") {
      return true;
    }
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers.authorization;
    const token = typeof header === "string" ? header.replace(/^Bearer\s+/i, "") : "";
    if (token !== this.expected) {
      throw new UnauthorizedException("invalid internal token");
    }
    return true;
  }
}
