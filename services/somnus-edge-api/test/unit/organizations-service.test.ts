import { UUIDv7 } from "@somnus/api-contracts";
import { describe, expect, it } from "vitest";
import { ACTOR_ID_HEADER } from "../../src/infrastructure/internal-clients/headers.js";
import { OrganizationsProxyService } from "../../src/modules/organizations/organizations.service.js";
import type { ActorResolver } from "../../src/modules/sessions/actor-resolver.service.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";
import { makeFakeIdentityClient } from "../support/fake-identity.js";

const ACTOR = "018f0000-0000-7000-8000-000000000abc";
const SESSION = { sessionId: "s1", somnusUserId: ACTOR } as unknown as SessionRecord;
const fakeResolver = { resolve: async () => ACTOR } as unknown as ActorResolver;

describe("OrganizationsProxyService", () => {
  it("creates an organization, forwarding actor and body", async () => {
    const org = { id: UUIDv7(), name: "Acme Health", status: "active" };
    const { client } = makeFakeIdentityClient((req) => {
      expect(req.method).toBe("POST");
      expect(req.path).toBe("/v1/organizations");
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      expect(JSON.parse(req.body ?? "{}")).toEqual({ name: "Acme Health" });
      return { status: 201, body: org };
    });
    const service = new OrganizationsProxyService(client, fakeResolver);

    expect(await service.create(SESSION, { name: "Acme Health" }, "c")).toEqual(org);
  });

  it("gets an organization by id (path-encoded)", async () => {
    const org = { id: UUIDv7(), name: "Acme", status: "active" };
    const { client } = makeFakeIdentityClient((req) => {
      expect(req.path).toBe("/v1/organizations/org-1");
      return { status: 200, body: org };
    });
    const service = new OrganizationsProxyService(client, fakeResolver);
    expect(await service.getById(SESSION, "org-1", "c")).toEqual(org);
  });

  it("lists members (array contract)", async () => {
    const members = [
      { id: UUIDv7(), organizationId: UUIDv7(), userId: UUIDv7(), status: "active" },
    ];
    const { client } = makeFakeIdentityClient((req) => {
      expect(req.path).toBe("/v1/organizations/org-1/members");
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      return { status: 200, body: members };
    });
    const service = new OrganizationsProxyService(client, fakeResolver);
    expect(await service.listMembers(SESSION, "org-1", "c")).toHaveLength(1);
  });

  it("invites a member, returning the create response with the token", async () => {
    const invitation = {
      id: UUIDv7(),
      organizationId: UUIDv7(),
      email: "invitee@example.com",
      status: "pending",
      expiresAt: new Date().toISOString(),
    };
    const { client } = makeFakeIdentityClient((req) => {
      expect(req.method).toBe("POST");
      expect(req.path).toBe("/v1/organizations/org-1/invitations");
      return { status: 201, body: { invitation, token: "tok-123" } };
    });
    const service = new OrganizationsProxyService(client, fakeResolver);
    const res = await service.invite(SESSION, "org-1", { email: "invitee@example.com" }, "c");
    expect(res.token).toBe("tok-123");
  });

  it("accepts an invitation by token", async () => {
    const invitation = {
      id: UUIDv7(),
      organizationId: UUIDv7(),
      email: "invitee@example.com",
      status: "accepted",
      expiresAt: new Date().toISOString(),
    };
    const { client } = makeFakeIdentityClient((req) => {
      expect(req.path).toBe("/v1/invitations/accept");
      expect(JSON.parse(req.body ?? "{}")).toEqual({ token: "tok-123" });
      return { status: 201, body: invitation };
    });
    const service = new OrganizationsProxyService(client, fakeResolver);
    expect(await service.acceptInvitation(SESSION, { token: "tok-123" }, "c")).toMatchObject({
      status: "accepted",
    });
  });

  it("maps a downstream 403 to FORBIDDEN", async () => {
    const { client } = makeFakeIdentityClient(() => ({
      status: 403,
      body: { error: { code: "FORBIDDEN", message: "no", correlationId: "x" } },
    }));
    const service = new OrganizationsProxyService(client, fakeResolver);
    await expect(service.getById(SESSION, "org-1", "c")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("throws INTERNAL when identity returns an unexpected organization shape", async () => {
    const { client } = makeFakeIdentityClient(() => ({ status: 200, body: { bogus: true } }));
    const service = new OrganizationsProxyService(client, fakeResolver);
    await expect(service.create(SESSION, { name: "Acme" }, "c")).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });
});
