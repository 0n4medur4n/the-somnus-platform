import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../test/utils.js";

const mocks = vi.hoisted(() => ({
  platformInvitations: vi.fn(),
  invitePlatformUser: vi.fn(),
  revokePlatformInvitation: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({ edge: mocks }));

import { PlatformInvitations } from "./PlatformInvitations.js";

const t = (key: string) => i18n.t(key);
const invitation = {
  id: "018f0000-0000-7000-8000-000000000001",
  firstName: "Ana",
  lastName: "Garcia",
  email: "ana@example.com",
  role: "professional",
  locale: "ca",
  status: "pending",
  invitedBy: "018f0000-0000-7000-8000-000000000002",
  createdAt: "2026-10-19T00:00:00.000Z",
  expiresAt: "2026-10-26T00:00:00.000Z",
  acceptedAt: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.platformInvitations.mockResolvedValue({ invitations: [] });
});
describe("Morpheo invitations", () => {
  it("submits the selected branch and language, without any privileged role", async () => {
    mocks.invitePlatformUser.mockResolvedValue({ invitation, emailQueued: true });
    renderWithProviders(<PlatformInvitations />);
    await userEvent.click(screen.getByRole("button", { name: t("platformInvite.add") }));
    await userEvent.type(screen.getByLabelText(t("staff.firstName")), "Ana");
    await userEvent.type(screen.getByLabelText(t("staff.lastName")), "Garcia");
    await userEvent.type(screen.getByLabelText(t("users.colEmail")), "ANA@example.com");
    await userEvent.selectOptions(screen.getByLabelText(t("platformInvite.type")), "professional");
    await userEvent.selectOptions(screen.getByLabelText(t("staff.emailLanguage")), "ca");
    await userEvent.click(screen.getByRole("button", { name: t("staff.send") }));
    expect(mocks.invitePlatformUser).toHaveBeenCalledWith({
      firstName: "Ana",
      lastName: "Garcia",
      email: "ana@example.com",
      role: "professional",
      locale: "ca",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(t("platformInvite.queued"));
  });
  it("resends only the create fields and reports a queue failure", async () => {
    mocks.platformInvitations.mockResolvedValue({ invitations: [invitation] });
    mocks.invitePlatformUser.mockResolvedValue({ invitation, emailQueued: false });
    renderWithProviders(<PlatformInvitations />);
    await userEvent.click(await screen.findByRole("button", { name: t("staff.resend") }));
    expect(await screen.findByRole("status")).toHaveTextContent(t("platformInvite.notQueued"));
    expect(mocks.invitePlatformUser.mock.calls[0]?.[0]).not.toHaveProperty("id");
  });
  it("revokes a pending invitation and offers only the two Morpheo branches", async () => {
    mocks.platformInvitations.mockResolvedValue({ invitations: [invitation] });
    renderWithProviders(<PlatformInvitations />);
    await userEvent.click(await screen.findByRole("button", { name: t("staff.revoke") }));
    expect(mocks.revokePlatformInvitation).toHaveBeenCalledWith(invitation.id);
    await userEvent.click(screen.getByRole("button", { name: t("platformInvite.add") }));
    expect(
      within(screen.getByLabelText(t("platformInvite.type"))).getAllByRole("option"),
    ).toHaveLength(2);
  });
});
