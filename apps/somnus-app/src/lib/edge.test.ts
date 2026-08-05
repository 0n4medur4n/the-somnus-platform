import { describe, expect, it, vi } from "vitest";

const { get, post, patch, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock("./api.js", () => ({ api: { get, post, patch, del } }));

const { edge } = await import("./edge.js");

describe("edge (typed edge-api surface)", () => {
  it("createSession posts the id token", () => {
    void edge.createSession("id-token");
    expect(post).toHaveBeenCalledWith("/v1/sessions", { idToken: "id-token" });
  });

  it("register posts to /v1/registration", () => {
    void edge.register({ firstName: "Ada", lastName: "L" });
    expect(post).toHaveBeenCalledWith("/v1/registration", { firstName: "Ada", lastName: "L" });
  });

  it("patchProfile patches /v1/me/profile", () => {
    void edge.patchProfile({ firstName: "A" });
    expect(patch).toHaveBeenCalledWith("/v1/me/profile", { firstName: "A" });
  });

  it("createOrganization posts to /v1/organizations", () => {
    void edge.createOrganization({ name: "Acme" });
    expect(post).toHaveBeenCalledWith("/v1/organizations", { name: "Acme" });
  });

  it("listMembers gets the org members path", () => {
    void edge.listMembers("org-1");
    expect(get).toHaveBeenCalledWith("/v1/organizations/org-1/members");
  });

  it("invite posts to the org invitations path", () => {
    void edge.invite("org-1", { email: "i@example.com" });
    expect(post).toHaveBeenCalledWith("/v1/organizations/org-1/invitations", {
      email: "i@example.com",
    });
  });

  it("acceptInvitation posts the token", () => {
    void edge.acceptInvitation({ token: "tok" });
    expect(post).toHaveBeenCalledWith("/v1/invitations/accept", { token: "tok" });
  });

  it("getMe and logout hit the right paths", () => {
    void edge.getMe();
    expect(get).toHaveBeenCalledWith("/v1/me");
    void edge.logout();
    expect(del).toHaveBeenCalledWith("/v1/sessions/current");
  });
});
