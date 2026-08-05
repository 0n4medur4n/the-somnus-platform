import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../lib/api.js";

const mocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  logout: vi.fn(),
  firebaseSignOut: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({ edge: { getMe: mocks.getMe, logout: mocks.logout } }));
vi.mock("./firebase-auth.js", () => ({ firebaseSignOut: mocks.firebaseSignOut }));

const { AuthProvider } = await import("./AuthProvider.js");
const { useAuth } = await import("./useAuth.js");

function Probe() {
  const { state, logout } = useAuth();
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <button type="button" onClick={() => void logout()}>
        logout
      </button>
    </div>
  );
}

const ME = {
  user: { id: "u", email: "u@example.com", locale: "es", status: "active" },
  individualProfile: null,
  professionalProfile: null,
};

describe("AuthProvider", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
  });

  it("is authenticated when /v1/me resolves", async () => {
    mocks.getMe.mockResolvedValue(ME);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
  });

  it("needs registration when /v1/me returns 404", async () => {
    mocks.getMe.mockRejectedValue(new ApiRequestError(404, "NOT_FOUND", "no user"));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("needs-registration"),
    );
  });

  it("is unauthenticated on 401", async () => {
    mocks.getMe.mockRejectedValue(new ApiRequestError(401, "UNAUTHENTICATED", "no session"));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
  });

  it("logout clears the session on both sides", async () => {
    mocks.getMe.mockResolvedValue(ME);
    mocks.logout.mockResolvedValue(undefined);
    mocks.firebaseSignOut.mockResolvedValue(undefined);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    await userEvent.click(screen.getByRole("button", { name: "logout" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
    expect(mocks.logout).toHaveBeenCalled();
    expect(mocks.firebaseSignOut).toHaveBeenCalled();
  });
});
