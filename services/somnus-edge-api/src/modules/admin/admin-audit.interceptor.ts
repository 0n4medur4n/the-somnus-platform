import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { makeEvent } from "@somnus/api-contracts";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { correlationOf } from "../../common/composition.util.js";
import {
  EDGE_EVENT_PUBLISHER,
  type EventPublisher,
} from "../../infrastructure/events/event-publisher.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { ADMIN_ROUTE_KEY, type AdminRouteMeta } from "./admin-route.decorator.js";

/**
 * Addendum A §A2.1: "There is no admin action without an audit record."
 *
 * One event per successful admin handler, emitted here rather than inside each
 * controller so a new route cannot forget it -- the same decorator that declares
 * the capability declares the event. A handler that throws emits nothing: the
 * action did not happen, and the guard's own denial is already an authorization
 * event, not an admin action.
 *
 * The envelope carries the acting admin's opaque user id and the route's
 * entity/action. Never a request body, never anything about the subject: §9
 * forbids that reaching analytics, and the audit module redacts on top.
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(EDGE_EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AdminRouteMeta | undefined>(ADMIN_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return next.handle();

    const request = context
      .switchToHttp()
      .getRequest<{ session?: SessionRecord; correlationId?: string }>();
    const correlationId = correlationOf(request.correlationId);
    const actorId = request.session?.somnusUserId ?? null;

    return next.handle().pipe(
      tap({
        next: () => {
          void this.emit(meta, actorId, correlationId);
        },
      }),
    );
  }

  /** Auditing never breaks the response the admin already earned. */
  private async emit(
    meta: AdminRouteMeta,
    actorId: string | null,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.events.publish(
        makeEvent({
          eventType: meta.eventType,
          producer: "somnus-edge-api",
          correlationId,
          ...(actorId ? { actor: { type: "user", id: actorId } } : {}),
          subject: { type: meta.entity, id: actorId ?? "unknown" },
          data: { capability: meta.capability },
        }),
      );
    } catch {
      // Deliberately swallowed: see the method doc.
    }
  }
}
