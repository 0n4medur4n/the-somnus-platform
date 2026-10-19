import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../lib/api.js";
import { i18n, renderWithProviders } from "../test/utils.js";

const mocks = vi.hoisted(() => ({
  platformInvitation: vi.fn(),
  acceptPlatformInvitation: vi.fn(),
  createSession: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({ edge: mocks }));
vi.mock("../auth/firebase-auth.js", () => ({
  isEmailLink: () => true,
  storedEmail: () => null,
  completeEmailLinkSignIn: async () => "fixture-id-token",
}));

import { AuthCallback } from "./AuthCallback.js";
import { PlatformInvitationEntry } from "./PlatformInvitationEntry.js";

const id = "018f0000-0000-7000-8000-000000000001";
const invitation = { id, firstName: "Ana", lastName: "Garcia", role: "adult", locale: "es" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.platformInvitation.mockResolvedValue(invitation);
  mocks.acceptPlatformInvitation.mockResolvedValue(undefined);
});
describe("Morpheo invitation entry", () => {
  it("leaves cross-device email confirmation after session exchange and loads the invitation", async () => {
    window.history.replaceState({}, "", `/?platformInvitation=${id}`);
    try {
      renderWithProviders(<AuthCallback />);
      await userEvent.type(
        await screen.findByLabelText(i18n.t("login.emailLabel")),
        "ana@example.com",
      );
      await userEvent.click(screen.getByRole("button", { name: i18n.t("callback.emailSubmit") }));
      expect(await screen.findByLabelText(i18n.t("register.firstName"))).toHaveValue("Ana");
      expect(mocks.createSession).toHaveBeenCalledWith("fixture-id-token");
      expect(mocks.platformInvitation).toHaveBeenCalledWith(id);
      expect(screen.queryByLabelText(i18n.t("login.emailLabel"))).not.toBeInTheDocument();
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });
  it("existing accounts accept without submitting profile data or consents", async () => {
    const onJoined = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<PlatformInvitationEntry invitationId={id} existing onJoined={onJoined} />);
    await userEvent.click(
      await screen.findByRole("button", { name: i18n.t("platformInvite.accept") }),
    );
    expect(mocks.acceptPlatformInvitation).toHaveBeenCalledWith({ invitationId: id });
    expect(onJoined).toHaveBeenCalledOnce();
  });
  it("new accounts see editable proposed names and no pre-accepted consent", async () => {
    renderWithProviders(
      <PlatformInvitationEntry invitationId={id} existing={false} onJoined={async () => {}} />,
    );
    expect(await screen.findByLabelText(i18n.t("register.firstName"))).toHaveValue("Ana");
    expect(screen.getByLabelText(i18n.t("register.lastName"))).toHaveValue("Garcia");
    expect(mocks.acceptPlatformInvitation).not.toHaveBeenCalled();
  });
  it.each(["es", "ca"])(
    "expired invitations have no fallback registration in %s",
    async (locale) => {
      await i18n.changeLanguage(locale);
      mocks.platformInvitation.mockRejectedValue(
        new ApiRequestError(410, "INVITATION_EXPIRED", "expired"),
      );
      renderWithProviders(
        <PlatformInvitationEntry invitationId={id} existing={false} onJoined={async () => {}} />,
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        i18n.t("invitation.errors.expired"),
      );
      expect(screen.queryByLabelText(i18n.t("register.firstName"))).not.toBeInTheDocument();
      await i18n.changeLanguage("es");
    },
  );
});
