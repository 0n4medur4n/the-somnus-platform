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
 * entity/action. By default it carries nothing else -- no request body, nothing
 * about the subject: §9 forbids that reaching analytics, and the audit module
 * redacts on top.
 *
 * One route needs more, and asks for it explicitly. Break-glass (§A2.3 /
 * Checkpoint 15.5) is required to record WHICH record was opened, under which
 * category, with which written justification -- an audit event saying only "an
 * admin used break-glass" would defeat the point of having the control. A
 * handler can therefore attach `adminAuditDetail` to the request and the
 * interceptor merges it into the envelope it was already going to emit.
 *
 * Merged, not emitted separately, and that is the whole reason for doing it this
 * way: Checkpoint 15.1's immutable test asserts every admin call produces
 * EXACTLY ONE audit event, and a second `publish` here would break it. The
 * privacy line still holds downstream -- the worker lifts the justification into
 * a column the analytics export has no field for, and the export drops subject
 * ids -- so what reaches BigQuery is unchanged.
 */

/**
 * What a handler may add to its own audit event. Opt-in, per route.
 *
 * `eventId` lets the handler pre-mint the id so it can tell the admin which
 * audit record their access wrote; without it the interceptor mints one as
 * before.
 */
export type AdminAuditDetail = {
  eventId?: string;
  subjectId?: string;
  data?: Record<string, unknown>;
};

/** Where a handler leaves it. Read once, on success, then forgotten. */
export type RequestWithAuditDetail = {
  session?: SessionRecord;
  correlationId?: string;
  adminAuditDetail?: AdminAuditDetail;
};
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

    const request = context.switchToHttp().getRequest<RequestWithAuditDetail>();
    const correlationId = correlationOf(request.correlationId);
    const actorId = request.session?.somnusUserId ?? null;

    return next.handle().pipe(
      tap({
        next: () => {
          // Read AFTER the handler ran: that is when the detail exists, and a
          // handler that threw has nothing to record.
          void this.emit(meta, actorId, correlationId, request.adminAuditDetail);
        },
      }),
    );
  }

  /** Auditing never breaks the response the admin already earned. */
  private async emit(
    meta: AdminRouteMeta,
    actorId: string | null,
    correlationId: string,
    detail?: AdminAuditDetail,
  ): Promise<void> {
    try {
      const event = makeEvent({
        eventType: meta.eventType,
        producer: "somnus-edge-api",
        correlationId,
        ...(actorId ? { actor: { type: "user", id: actorId } } : {}),
        subject: { type: meta.entity, id: detail?.subjectId ?? actorId ?? "unknown" },
        data: { capability: meta.capability, ...detail?.data },
      });
      await this.events.publish(detail?.eventId ? { ...event, eventId: detail.eventId } : event);
    } catch {
      // Deliberately swallowed: see the method doc.
    }
  }
}
