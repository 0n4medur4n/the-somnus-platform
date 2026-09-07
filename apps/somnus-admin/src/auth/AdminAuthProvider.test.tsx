import type { AdminMeResponse } from "@somnus/api-contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../lib/api.js";

const mocks = vi.hoisted(() => ({
  adminMe: vi.fn(),
  logout: vi.fn(),
  firebaseSignOut: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({
  edge: { adminMe: mocks.adminMe, logout: mocks.logout },
}));
vi.mock("./firebase-auth.js", () => ({ firebaseSignOut: mocks.firebaseSignOut }));

const { AdminAuthProvider } = await import("./AdminAuthProvider.js");
const { useAdminAuth } = await import("./useAdminAuth.js");

function Probe() {
  const { state, logout } = useAdminAuth();
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="roles">
        {state.status === "authorized" ? state.me.roleKeys.join(",") : ""}
      </span>
      <button type="button" onClick={() => void logout()}>
        logout
      </button>
    </div>
  );
}

const ME: AdminMeResponse = {
  user: {
    id: "018f0000-0000-7000-8000-000000000abc",
    email: "admin@somnus.test",
    locale: "es",
    status: "active",
  },
  roleKeys: ["platform_admin"],
  capabilities: ["admin_users_read"],
};

/**
 * Addendum A Checkpoint 15.1: this provider IS the console's gate. Everything
 * the app renders follows from which of these four states it lands in, so each
 * server answer is asserted individually -- especially the distinction between
 * "no session" and "a session that is not an admin", which drives whether the
 * person sees a sign-in form or a denial screen.
 */
describe("AdminAuthProvider maps the server's answer to a gate state", () => {
  beforeEach(() => {
    mocks.adminMe.mockReset();
    mocks.logout.mockReset();
    mocks.firebaseSignOut.mockReset();
  });

  it("starts in loading and never renders a decision it has not received", async () => {
    let resolve: ((value: AdminMeResponse) => void) | undefined;
    mocks.adminMe.mockReturnValue(
      new Promise<AdminMeResponse>((r) => {
        resolve = r;
      }),
    );

    render(
      <AdminAuthProvider>
        <Probe />
      </AdminAuthProvider>,
    );
    expect(screen.getByTestId("status")).toHaveTextContent("loading");

    resolve?.(ME);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authorized"));
  });

  it("200 -> authorized, carrying the roles and capabilities the server resolved", async () => {
    mocks.adminMe.mockResolvedValue(ME);

    render(
      <AdminAuthProvider>
        <Probe />
      </AdminAuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authorized"));
    expect(screen.getByTestId("roles")).toHaveTextContent("platform_admin");
  });

  it("403 -> denied: a real session that the gate refused", async () => {
    mocks.adminMe.mockRejectedValue(new ApiRequestError(403, "FORBIDDEN", "no"));

    render(
      <AdminAuthProvider>
        <Probe />
      </AdminAuthProvider>,
    );

    // Denied, NOT unauthenticated: this person is signed in, and sending them
    // back to a sign-in form would loop them forever.
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("denied"));
  });

  it("401 -> unauthenticated: there is no session to refuse", async () => {
    mocks.adminMe.mockRejectedValue(new ApiRequestError(401, "UNAUTHENTICATED", "no"));

    render(
      <AdminAuthProvider>
        <Probe />
      </AdminAuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
  });

  it.each([500, 502, 404])(
    "treats a %s as unauthenticated rather than assuming access",
    async (status) => {
      mocks.adminMe.mockRejectedValue(new ApiRequestError(status, "INTERNAL", "boom"));

      render(
        <AdminAuthProvider>
          <Probe />
        </AdminAuthProvider>,
      );

      // Fail closed: an unreadable answer is never read as "authorized".
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"),
      );
    },
  );

  it("treats a non-API failure as unauthenticated too", async () => {
    mocks.adminMe.mockRejectedValue(new Error("network down"));

    render(
      <AdminAuthProvider>
        <Probe />
      </AdminAuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
  });

  describe("logout", () => {
    it("clears the edge session and Firebase, then drops to unauthenticated", async () => {
      mocks.adminMe.mockResolvedValue(ME);
      mocks.logout.mockResolvedValue(undefined);
      mocks.firebaseSignOut.mockResolvedValue(undefined);

      render(
        <AdminAuthProvider>
          <Probe />
        </AdminAuthProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authorized"));

      await userEvent.click(screen.getByRole("button", { name: "logout" }));

      expect(mocks.logout).toHaveBeenCalledTimes(1);
      expect(mocks.firebaseSignOut).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"),
      );
    });

    it("still ends signed out when either side was already gone", async () => {
      mocks.adminMe.mockResolvedValue(ME);
      mocks.logout.mockRejectedValue(new Error("session already cleared"));
      mocks.firebaseSignOut.mockRejectedValue(new Error("already signed out"));

      render(
        <AdminAuthProvider>
          <Probe />
        </AdminAuthProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authorized"));

      await userEvent.click(screen.getByRole("button", { name: "logout" }));
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"),
      );
    });
  });
});

describe("useAdminAuth", () => {
  it("refuses to be used outside the provider", () => {
    // Rendering the probe alone must fail loudly rather than silently
    // defaulting to some state.
    expect(() => render(<Probe />)).toThrow(/AdminAuthProvider/);
  });
});
