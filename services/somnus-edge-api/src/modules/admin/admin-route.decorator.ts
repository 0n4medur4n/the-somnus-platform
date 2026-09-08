import { SetMetadata } from "@nestjs/common";
import type { AdminCapability } from "@somnus/api-contracts";

export const ADMIN_ROUTE_KEY = "somnus:admin-route";

/**
 * What an `/admin/v1/*` handler declares about itself (Addendum A Checkpoint
 * 15.1). Both halves are mandatory, because both are gate requirements: the
 * capability the role guard enforces, and the audit event §A2.1 says every
 * admin action must emit.
 */
export type AdminRouteMeta = {
  /**
   * The A2.2 capability this route requires, or `any_internal_role` for the
   * shell's own endpoint -- the one call an admin makes before the console
   * knows what they may do.
   */
  capability: AdminCapability | "any_internal_role";
  /** `admin.<entity>.<action>.v1` (§A2.1). */
  eventType: string;
  /** The entity the action touched, for the event's subject. */
  entity: string;
};

/**
 * Marks a handler as an admin route. A handler WITHOUT this decorator is
 * refused by the guard: a new `/admin/v1/*` route that forgets to declare its
 * capability fails closed rather than shipping unguarded.
 */
export const AdminRoute = (meta: AdminRouteMeta) => SetMetadata(ADMIN_ROUTE_KEY, meta);
