import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../lib/api.js";

const mocks = vi.hoisted(() => ({
  adminMe: vi.fn(),
  myStaffInvitation: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({
  edge: { adminMe: mocks.adminMe, myStaffInvitation: mocks.myStaffInvitation, logout: vi.fn() },
}));
vi.mock("./firebase-auth.js", () => ({ firebaseSignOut: vi.fn() }));

const { AdminAuthProvider } = await import("./AdminAuthProvider.js");
const { useAdminAuth } = await import("./useAdminAuth.js");

function Probe() {
  const { state } = useAdminAuth();
  return (
    <span data-testid="status">
      {state.status}
      {state.status === "invited" ? `:${state.invitation.roleKey}` : ""}
    </span>
  );
}

const INVITATION = {
  firstName: "Ana",
  roleKey: "support_agent",
  expiresAt: "2026-10-25T12:00:00.000Z",
} as const;

/**
 * Staff invitations (owner decision 2026-10-18): a signed-in person the gate
 * refuses -- or who has no account yet -- may have been invited. Only then does
 * the console show the invitation; every other answer maps exactly as before.
 */
describe("AdminAuthProvider and a pending staff invitation", () => {
  beforeEach(() => {
    mocks.adminMe.mockReset();
    mocks.myStaffInvitation.mockReset();
  });
  it("offers an additional invitation even when the person already has an internal role", async () => {
    mocks.adminMe.mockResolvedValue({
      user: {
        id: "018f0000-0000-7000-8000-000000000001",
        email: "ana@example.com",
        locale: "es",
        status: "active",
      },
      roleKeys: ["professional_verifier"],
      capabilities: ["admin_users_read"],
    });
    mocks.myStaffInvitation.mockResolvedValue({ invitation: INVITATION });
    render(
      <AdminAuthProvider>
        <Probe />
      </AdminAuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("invited:support_agent"),
    );
  });

  it.each([403, 404])("%s with an invitation waiting -> invited", async (status) => {
    mocks.adminMe.mockRejectedValue(new ApiRequestError(status, "X", "no"));
    mocks.myStaffInvitation.mockResolvedValue({ invitation: INVITATION });
    render(
      <AdminAuthProvider>
        <Probe />
      </AdminAuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("invited:support_agent"),
    );
  });

  it("403 with no invitation stays denied", async () => {
    mocks.adminMe.mockRejectedValue(new ApiRequestError(403, "FORBIDDEN", "no"));
    mocks.myStaffInvitation.mockResolvedValue({ invitation: null });
    render(
      <AdminAuthProvider>
        <Probe />
      </AdminAuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("denied"));
  });

  it("an unreadable invitation answer falls back to what the gate said", async () => {
    mocks.adminMe.mockRejectedValue(new ApiRequestError(404, "NOT_FOUND", "no"));
    mocks.myStaffInvitation.mockRejectedValue(new ApiRequestError(500, "INTERNAL", "boom"));
    render(
      <AdminAuthProvider>
        <Probe />
      </AdminAuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
  });

  it("401 means no session: nothing is asked about invitations", async () => {
    mocks.adminMe.mockRejectedValue(new ApiRequestError(401, "UNAUTHENTICATED", "no"));
    render(
      <AdminAuthProvider>
        <Probe />
      </AdminAuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
    expect(mocks.myStaffInvitation).not.toHaveBeenCalled();
  });
});
