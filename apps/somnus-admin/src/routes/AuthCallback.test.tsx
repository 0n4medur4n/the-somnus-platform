import { screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuthContext, type AdminAuthState } from "../auth/AdminAuthContext.js";
import { i18n, renderWithProviders } from "../test/utils.js";

const { completeEmailLinkSignIn, createSession } = vi.hoisted(() => ({
  completeEmailLinkSignIn: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("../auth/firebase-auth.js", () => ({
  isEmailLink: () => true,
  storedEmail: () => "staff@thesomnus.com",
  completeEmailLinkSignIn,
  sendLoginLink: vi.fn(),
  firebaseSignOut: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({ edge: { createSession } }));

const { AuthCallback } = await import("./AuthCallback.js");

/** A real, changing auth state: `refresh` lands on whatever the server would say. */
function Harness({ after }: { after: AdminAuthState }) {
  const [state, setState] = useState<AdminAuthState>({ status: "loading" });
  return (
    <AdminAuthContext.Provider
      value={{ state, refresh: async () => setState(after), logout: async () => {} }}
    >
      <AuthCallback />
    </AdminAuthContext.Provider>
  );
}

beforeEach(() => {
  completeEmailLinkSignIn.mockReset();
  createSession.mockReset();
});

describe("AuthCallback", () => {
  /**
   * 2026-10-18: the link was redeemed and the session created, but the console
   * could not read it back -- and the screen simply stayed put. The person
   * pressed again, and was told the (now spent) link had expired.
   */
  it("says the session could not be opened when the link worked but no session reads back", async () => {
    completeEmailLinkSignIn.mockResolvedValue("id-token");
    createSession.mockResolvedValue({});
    renderWithProviders(<Harness after={{ status: "unauthenticated" }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("callback.sessionError"));
    expect(createSession).toHaveBeenCalledWith("id-token");
  });

  it("reports a spent or invalid link as such", async () => {
    completeEmailLinkSignIn.mockRejectedValue(
      Object.assign(new Error("invalid"), { code: "auth/invalid-action-code" }),
    );
    renderWithProviders(<Harness after={{ status: "unauthenticated" }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("callback.error"));
    expect(createSession).not.toHaveBeenCalled();
  });
});
