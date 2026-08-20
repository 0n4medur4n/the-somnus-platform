import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { loadNotificationConfig } from "./notification.config.js";

/**
 * Guards the Cloud Tasks consumer. The worker is a private Cloud Run service; in
 * staging/production Cloud Tasks presents a bearer token (OIDC), checked here.
 * Locally the token is unset and the guard is a no-op — the full OIDC verification
 * hardening lands with the deploy work (§21 / Phase 13).
 */
@Injectable()
export class CloudTasksAuthGuard implements CanActivate {
  private readonly expected = loadNotificationConfig(process.env).CLOUD_TASKS_AUTH_TOKEN;

  canActivate(context: ExecutionContext): boolean {
    if (this.expected === "") {
      return true;
    }
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers.authorization;
    const token = typeof header === "string" ? header.replace(/^Bearer\s+/i, "") : "";
    if (token !== this.expected) {
      throw new UnauthorizedException("invalid Cloud Tasks token");
    }
    return true;
  }
}
