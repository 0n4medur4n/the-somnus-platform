import { describe, expect, it, vi } from "vitest";

const { get, post, patch, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock("./api.js", () => ({ api: { get, post, patch, del } }));

const { edge } = await import("./edge.js");

/**
 * The console's entire backend surface (Addendum A §A2.1). The point of these
 * is as much what is absent as what is present: the console has no method for a
 * consumer route, so it cannot accidentally start composing `/v1/me` or reading
 * someone's profile.
 */
describe("edge (admin console surface)", () => {
  it("exchanges the magic-link token on the shared session route", () => {
    void edge.createSession("id-token");
    expect(post).toHaveBeenCalledWith("/v1/sessions", { idToken: "id-token" });
  });

  it("reads the shell from /admin/v1/me", () => {
    void edge.adminMe();
    expect(get).toHaveBeenCalledWith("/admin/v1/me");
  });

  it("signs out through the shared session route", () => {
    void edge.logout();
    expect(del).toHaveBeenCalledWith("/v1/sessions/current");
  });

  it("touches no path outside /admin/v1 and the shared session routes", () => {
    // Earlier tests in this file already drove some of these mocks.
    for (const spy of [get, post, patch, del]) spy.mockClear();

    // Every method is driven and every path it produced is checked, so the
    // assertion holds as the console grows rather than freezing today's list.
    // The console must never start composing a consumer route.
    const calls = [
      () => edge.searchUsers({ limit: 10 }),
      () => edge.userDetail("u1"),
      () => edge.setUserStatus("u1", { status: "suspended", reason: "why" }),
      () => edge.deletionRequests(),
      () => edge.decideDeletion("d1", { decision: "cancel", reason: "why" }),
      () => edge.organizations(),
      () => edge.createOrganization({ name: "Org" }),
      () => edge.setOrganizationStatus("o1", { status: "active", reason: "why" }),
      () => edge.organizationMembers("o1"),
      () => edge.verificationQueue(),
      () => edge.decideVerification("c1", { decision: "approve", reason: "why" }),
      () =>
        edge.assignRole({
          targetUserId: "018f0000-0000-7000-8000-0000000000ff",
          roleKey: "support_agent",
        }),
      () => edge.adminMe(),
      () => edge.createSession("token"),
      () => edge.logout(),
    ];
    for (const call of calls) void call();

    const paths = [...get.mock.calls, ...post.mock.calls, ...patch.mock.calls, ...del.mock.calls]
      .map(([path]) => path as string)
      .filter((path) => path !== undefined);

    expect(paths.length).toBe(calls.length);
    const SHARED_SESSION_ROUTES = ["/v1/sessions", "/v1/sessions/current"];
    for (const path of paths) {
      const allowed = path.startsWith("/admin/v1/") || SHARED_SESSION_ROUTES.includes(path);
      expect(allowed, `${path} is outside the console's surface`).toBe(true);
    }
  });
});
