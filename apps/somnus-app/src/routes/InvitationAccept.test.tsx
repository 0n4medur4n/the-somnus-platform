import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "../auth/AuthContext.js";
import { ApiRequestError } from "../lib/api.js";
import { i18n, renderWithProviders } from "../test/utils.js";

const { sendLoginLink } = vi.hoisted(() => ({ sendLoginLink: vi.fn() }));
vi.mock("../auth/firebase-auth.js", () => ({ sendLoginLink }));

const { previewInvitation, acceptInvitation } = vi.hoisted(() => ({
  previewInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({ edge: { previewInvitation, acceptInvitation } }));

const { InvitationAccept } = await import("./InvitationAccept.js");

const t = (key: string, vars?: Record<string, string>) => i18n.t(key, vars ?? {});

const PREVIEW = {
  organizationName: "Nox Research Lab",
  email: "invited@example.com",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

const TOKEN_KEY = "somnus_pending_invitation";
const ROUTE = "/invitation/accept?token=tok-1";

function auth(
  status: "unauthenticated" | "authenticated" | "needs-registration",
): AuthContextValue {
  const state =
    status === "authenticated"
      ? ({
          status,
          me: {
            user: { id: "u1", email: "invited@example.com", locale: "es", status: "active" },
            individualProfile: null,
            professionalProfile: null,
          },
        } as AuthContextValue["state"])
      : ({ status } as AuthContextValue["state"]);
  return { state, refresh: async () => {}, logout: async () => {} };
}

describe("InvitationAccept (Addendum A Checkpoint 14.2: the only door into Nox)", () => {
  beforeEach(() => {
    previewInvitation.mockReset();
    acceptInvitation.mockReset();
    sendLoginLink.mockReset();
    sendLoginLink.mockResolvedValue(undefined);
    window.sessionStorage.clear();
  });

  it("shows who invited you and sends the magic link to the invited address", async () => {
    previewInvitation.mockResolvedValue(PREVIEW);
    renderWithProviders(<InvitationAccept />, { auth: auth("unauthenticated"), route: ROUTE });

    expect(
      await screen.findByText(
        t("invitation.invitedTo", { organization: PREVIEW.organizationName }),
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(previewInvitation).toHaveBeenCalledWith({ token: "tok-1" }));

    // The address is shown but not editable: the invitation is bound to it.
    const emailField = screen.getByLabelText(t("invitation.emailLabel"));
    expect(emailField).toHaveValue(PREVIEW.email);
    expect(emailField).toHaveAttribute("readonly");

    await userEvent.click(screen.getByRole("button", { name: t("invitation.continueCta") }));

    await waitFor(() => expect(sendLoginLink).toHaveBeenCalledWith(PREVIEW.email));
    // The token is parked so it survives the trip through the inbox.
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBe("tok-1");
    expect(
      await screen.findByText(t("invitation.linkSent", { email: PREVIEW.email })),
    ).toBeInTheDocument();
  });

  it("an already-signed-in invitee accepts with the token from the link", async () => {
    previewInvitation.mockResolvedValue(PREVIEW);
    acceptInvitation.mockResolvedValue({ status: "accepted" });
    renderWithProviders(<InvitationAccept />, { auth: auth("authenticated"), route: ROUTE });

    const joinButton = await screen.findByRole("button", {
      name: t("invitation.acceptCta", { organization: PREVIEW.organizationName }),
    });
    await userEvent.click(joinButton);

    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledWith({ token: "tok-1" }));
    expect(
      await screen.findByText(t("invitation.accepted", { organization: PREVIEW.organizationName })),
    ).toBeInTheDocument();
    // Nothing left parked once the invitation has been used.
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(sendLoginLink).not.toHaveBeenCalled();
  });

  // --- Unusable invitations are terminal (never a fallback to open signup) ---

  it.each([
    ["INVITATION_EXPIRED", 410, "invitation.errors.expired"],
    ["INVITATION_ALREADY_USED", 409, "invitation.errors.alreadyUsed"],
    ["INVITATION_NOT_FOUND", 404, "invitation.errors.notFound"],
  ])("%s shows its own message and offers no way to register anyway", async (code, status, key) => {
    previewInvitation.mockRejectedValue(new ApiRequestError(status as number, code as string, "x"));
    renderWithProviders(<InvitationAccept />, { auth: auth("unauthenticated"), route: ROUTE });

    expect(await screen.findByText(t("invitation.errorTitle"))).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(t(key as string));
    expect(screen.getByText(t("invitation.noOpenSignup"))).toBeInTheDocument();

    // Nox has no other door: the only link on the screen is the layout's
    // skip-to-content, and nothing points at login, signup or registration.
    const hrefs = screen.queryAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["#main"]);
    expect(screen.queryByRole("button", { name: t("invitation.continueCta") })).toBeNull();
    expect(sendLoginLink).not.toHaveBeenCalled();
  });

  it("a link with no token at all is refused without calling the API", async () => {
    renderWithProviders(<InvitationAccept />, {
      auth: auth("unauthenticated"),
      route: "/invitation/accept",
    });

    expect(await screen.findByText(t("invitation.errorTitle"))).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(t("invitation.errors.missingToken"));
    expect(previewInvitation).not.toHaveBeenCalled();
  });

  it("drops the parked token when the invitation turns out to be dead", async () => {
    window.sessionStorage.setItem(TOKEN_KEY, "tok-1");
    previewInvitation.mockRejectedValue(new ApiRequestError(410, "INVITATION_EXPIRED", "x"));
    renderWithProviders(<InvitationAccept />, { auth: auth("unauthenticated"), route: ROUTE });

    await screen.findByText(t("invitation.errorTitle"));
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("surfaces an email mismatch from the accept call in the invitee's language", async () => {
    previewInvitation.mockResolvedValue(PREVIEW);
    acceptInvitation.mockRejectedValue(
      new ApiRequestError(403, "INVITATION_EMAIL_MISMATCH", "mismatch"),
    );
    renderWithProviders(<InvitationAccept />, { auth: auth("authenticated"), route: ROUTE });

    await userEvent.click(
      await screen.findByRole("button", {
        name: t("invitation.acceptCta", { organization: PREVIEW.organizationName }),
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("invitation.errors.emailMismatch"),
    );
  });
});
