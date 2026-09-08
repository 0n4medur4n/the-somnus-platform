import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { ADMIN_CAPABILITIES, type AdminCapability, UUIDv7 } from "@somnus/api-contracts";
import { describe, expect, it, vi } from "vitest";
import type { AdminProxyService } from "../../src/modules/admin/admin.service.js";
import { AdminCapabilityGuard } from "../../src/modules/admin/admin-capability.guard.js";
import {
  ADMIN_ROUTE_KEY,
  type AdminRouteMeta,
} from "../../src/modules/admin/admin-route.decorator.js";
import type { ActorResolver } from "../../src/modules/sessions/actor-resolver.service.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";

/**
 * Addendum A §A2.1 / Checkpoint 15.1: the mechanics of the `/admin/v1/*` gate.
 *
 * The matrix itself is identity's (tested exhaustively in
 * `admin-capability-policy.test.ts`). What is under test here is that edge-api
 * asks the right question, honours the answer, and fails closed when anything
 * is missing -- because a guard that quietly passes is worse than no guard.
 */

const ACTOR = "018f0000-0000-7000-8000-000000000abc";
const SESSION = { sessionId: "s1", somnusUserId: ACTOR } as unknown as SessionRecord;

function contextWith(meta: AdminRouteMeta | undefined, session: SessionRecord | undefined) {
  const reflector = {
    getAllAndOverride: (key: string) => (key === ADMIN_ROUTE_KEY ? meta : undefined),
  } as unknown as Reflector;

  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ session, correlationId: "corr-1" }),
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;

  return { reflector, context };
}

const resolver = { resolve: async () => ACTOR } as unknown as ActorResolver;

function proxy(over: Partial<AdminProxyService>): AdminProxyService {
  return {
    checkCapability: vi.fn(),
    context: vi.fn(),
    hasAnyInternalRole: vi.fn(),
    me: vi.fn(),
    ...over,
  } as unknown as AdminProxyService;
}

describe("AdminCapabilityGuard fails closed", () => {
  it("refuses a handler that declares no capability at all", async () => {
    const { reflector, context } = contextWith(undefined, SESSION);
    const guard = new AdminCapabilityGuard(reflector, proxy({}), resolver);

    // A new /admin/v1 route that forgets the decorator must not ship open.
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses when there is no session", async () => {
    const { reflector, context } = contextWith(
      { capability: "admin_users_read", eventType: "admin.user.read.v1", entity: "user" },
      undefined,
    );
    const guard = new AdminCapabilityGuard(reflector, proxy({}), resolver);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("AdminCapabilityGuard asks identity the route's own question", () => {
  it.each(ADMIN_CAPABILITIES)("forwards %s verbatim and allows on approval", async (capability) => {
    const checkCapability = vi.fn().mockResolvedValue({
      allowed: true,
      decisionId: UUIDv7(),
      reasonCode: "AUTHORIZED_BY_INTERNAL_ROLE",
    });
    const { reflector, context } = contextWith(
      { capability, eventType: `admin.x.y.v1`, entity: "x" },
      SESSION,
    );
    const guard = new AdminCapabilityGuard(reflector, proxy({ checkCapability }), resolver);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(checkCapability).toHaveBeenCalledWith(ACTOR, capability, expect.any(String));
  });

  it.each(ADMIN_CAPABILITIES)(
    "denies %s when identity refuses, carrying the reason",
    async (capability) => {
      const checkCapability = vi.fn().mockResolvedValue({
        allowed: false,
        decisionId: UUIDv7(),
        reasonCode: "DENIED_CAPABILITY_NOT_GRANTED",
      });
      const { reflector, context } = contextWith(
        { capability, eventType: "admin.x.y.v1", entity: "x" },
        SESSION,
      );
      const guard = new AdminCapabilityGuard(reflector, proxy({ checkCapability }), resolver);

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: "FORBIDDEN",
        details: { reasonCode: "DENIED_CAPABILITY_NOT_GRANTED" },
      });
    },
  );

  it("uses the internal-role check, not a capability check, for the shell endpoint", async () => {
    const checkCapability = vi.fn();
    const hasAnyInternalRole = vi
      .fn()
      .mockResolvedValue({ allowed: true, reasonCode: "AUTHORIZED_BY_INTERNAL_ROLE" });
    const { reflector, context } = contextWith(
      {
        capability: "any_internal_role",
        eventType: "admin.session.opened.v1",
        entity: "admin_session",
      },
      SESSION,
    );
    const guard = new AdminCapabilityGuard(
      reflector,
      proxy({ checkCapability, hasAnyInternalRole }),
      resolver,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(hasAnyInternalRole).toHaveBeenCalledWith(ACTOR, expect.any(String));
    expect(checkCapability).not.toHaveBeenCalled();
  });

  it("denies the shell endpoint when the actor holds no internal role", async () => {
    const hasAnyInternalRole = vi
      .fn()
      .mockResolvedValue({ allowed: false, reasonCode: "DENIED_NOT_AN_INTERNAL_ROLE" });
    const { reflector, context } = contextWith(
      {
        capability: "any_internal_role",
        eventType: "admin.session.opened.v1",
        entity: "admin_session",
      },
      SESSION,
    );
    const guard = new AdminCapabilityGuard(reflector, proxy({ hasAnyInternalRole }), resolver);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { reasonCode: "DENIED_NOT_AN_INTERNAL_ROLE" },
    });
  });

  it("holds no capability list of its own", async () => {
    // The guard never consults a local table: with identity answering "no" for
    // a capability a super admin holds, the guard still denies.
    const checkCapability = vi.fn().mockResolvedValue({
      allowed: false,
      decisionId: UUIDv7(),
      reasonCode: "DENIED_CAPABILITY_NOT_GRANTED",
    });
    const capability: AdminCapability = "admin_users_read";
    const { reflector, context } = contextWith(
      { capability, eventType: "admin.user.read.v1", entity: "user" },
      SESSION,
    );
    const guard = new AdminCapabilityGuard(reflector, proxy({ checkCapability }), resolver);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
