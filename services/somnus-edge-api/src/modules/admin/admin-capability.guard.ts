import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { correlationOf, requireSession } from "../../common/composition.util.js";
import { ActorResolver } from "../sessions/actor-resolver.service.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { AdminProxyService } from "./admin.service.js";
import { ADMIN_ROUTE_KEY, type AdminRouteMeta } from "./admin-route.decorator.js";

/**
 * The `/admin/v1/*` role guard (Addendum A §A2.1 / Checkpoint 15.1).
 *
 * It holds no part of the capability matrix. It reads what the route declared,
 * resolves the acting Somnus user, and asks identity -- which owns every
 * authorization decision on this platform (build plan §5.3 / §11). A denial
 * comes back as 403 with identity's own reason code in `details`, so the
 * console can tell "you are not an admin" from "you are, but not for this".
 *
 * Fails closed twice over: no route metadata means denied, and any error
 * reaching here is a denial, never a pass-through.
 */
@Injectable()
export class AdminCapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly admin: AdminProxyService,
    private readonly actorResolver: ActorResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ session?: SessionRecord; correlationId?: string }>();
    const correlationId = correlationOf(request.correlationId);

    const meta = this.reflector.getAllAndOverride<AdminRouteMeta | undefined>(ADMIN_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) {
      // An /admin/v1 handler with no declared capability is a bug, and the safe
      // reading of a bug on an admin route is "no".
      throw new SomnusError(ErrorCode.FORBIDDEN, "This admin route declares no capability.", {
        correlationId,
      });
    }

    const session = requireSession(request.session, correlationId);
    const actorId = await this.actorResolver.resolve(session, correlationId);

    const decision =
      meta.capability === "any_internal_role"
        ? await this.admin.hasAnyInternalRole(actorId, correlationId)
        : await this.admin.checkCapability(actorId, meta.capability, correlationId);

    if (!decision.allowed) {
      throw new SomnusError(ErrorCode.FORBIDDEN, "Not allowed in the admin console.", {
        correlationId,
        details: { reasonCode: decision.reasonCode },
      });
    }
    return true;
  }
}
