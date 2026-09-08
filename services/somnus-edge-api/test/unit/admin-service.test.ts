import { UUIDv7 } from "@somnus/api-contracts";
import { describe, expect, it } from "vitest";
import { ACTOR_ID_HEADER } from "../../src/infrastructure/internal-clients/headers.js";
import { AdminProxyService } from "../../src/modules/admin/admin.service.js";
import { makeFakeIdentityClient } from "../support/fake-identity.js";

const ACTOR = "018f0000-0000-7000-8000-000000000abc";

/**
 * Addendum A Checkpoint 15.1: edge-api's half of the admin gate is a proxy and
 * nothing more. These assert what it sends to identity and that it refuses to
 * invent an answer when identity's response does not match the contract --
 * a malformed authorization answer must never be read as permission.
 */
describe("AdminProxyService", () => {
  it("asks identity about one capability, forwarding no actor header", async () => {
    const { client, requests } = makeFakeIdentityClient((req) => {
      expect(req.path).toBe("/internal/v1/authorization/admin-check");
      expect(JSON.parse(req.body ?? "{}")).toEqual({
        actorUserId: ACTOR,
        capability: "admin_break_glass",
      });
      // The actor travels in the body of an authorization question, not as the
      // acting-user header that identity's data routes use.
      expect(req.headers[ACTOR_ID_HEADER]).toBeUndefined();
      return {
        status: 200,
        body: { allowed: true, decisionId: UUIDv7(), reasonCode: "AUTHORIZED_BY_INTERNAL_ROLE" },
      };
    });

    const decision = await new AdminProxyService(client).checkCapability(
      ACTOR,
      "admin_break_glass",
      "corr-1",
    );

    expect(decision.allowed).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it("carries a denial through unchanged", async () => {
    const { client } = makeFakeIdentityClient(() => ({
      status: 200,
      body: { allowed: false, decisionId: UUIDv7(), reasonCode: "DENIED_CAPABILITY_NOT_GRANTED" },
    }));

    const decision = await new AdminProxyService(client).checkCapability(
      ACTOR,
      "admin_roles_assign",
      "corr-1",
    );

    expect(decision).toMatchObject({
      allowed: false,
      reasonCode: "DENIED_CAPABILITY_NOT_GRANTED",
    });
  });

  it("refuses an unexpected authorization response rather than guessing", async () => {
    const { client } = makeFakeIdentityClient(() => ({ status: 200, body: { allowed: "yes" } }));

    // An INTERNAL error becomes a 500, never a silent allow.
    await expect(
      new AdminProxyService(client).checkCapability(ACTOR, "admin_users_read", "corr-1"),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("resolves the shell context and reports having no internal role", async () => {
    const { client } = makeFakeIdentityClient(() => ({
      status: 200,
      body: { roleKeys: [], capabilities: [] },
    }));

    const service = new AdminProxyService(client);
    expect(await service.hasAnyInternalRole(ACTOR, "corr-1")).toEqual({
      allowed: false,
      reasonCode: "DENIED_NOT_AN_INTERNAL_ROLE",
    });
  });

  it("composes /admin/v1/me from identity's user plus the resolved capabilities", async () => {
    const { client } = makeFakeIdentityClient((req) => {
      if (req.path === "/v1/me") {
        expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
        return {
          status: 200,
          body: {
            user: { id: ACTOR, email: "admin@example.com", locale: "es", status: "active" },
            individualProfile: { firstName: "Ada", lastName: "Lovelace" },
            professionalProfile: null,
          },
        };
      }
      return {
        status: 200,
        body: { roleKeys: ["platform_admin"], capabilities: ["admin_users_read"] },
      };
    });

    const me = await new AdminProxyService(client).me(ACTOR, "corr-1");

    expect(me.user.email).toBe("admin@example.com");
    expect(me.roleKeys).toEqual(["platform_admin"]);
    expect(me.capabilities).toEqual(["admin_users_read"]);
    // The console is told who is signed in, not their clinical profile.
    expect(me).not.toHaveProperty("individualProfile");
    expect(me).not.toHaveProperty("professionalProfile");
  });
});
