import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../test/utils.js";

const mocks = vi.hoisted(() => ({
  searchUsers: vi.fn(),
  userDetail: vi.fn(),
  staffInvitations: vi.fn(),
  inviteStaff: vi.fn(),
  assignRole: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({ edge: mocks }));

import { RolesScreen } from "./RolesScreen.js";

const actorId = "018f0000-0000-7000-8000-000000000001";
const user = {
  id: "018f0000-0000-7000-8000-000000000002",
  email: "ana@example.com",
  locale: "ca",
  status: "active",
  createdAt: "2026-10-01T09:00:00Z",
};
const t = i18n.t.bind(i18n);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchUsers.mockResolvedValue({ users: [user], truncated: false });
  mocks.userDetail.mockResolvedValue({
    user,
    individualProfile: { firstName: "Ana", lastName: "Garcia" },
  });
  mocks.staffInvitations.mockResolvedValue({ invitations: [] });
  mocks.inviteStaff.mockResolvedValue({ invitation: { email: user.email }, emailSent: true });
  mocks.assignRole.mockResolvedValue({});
});
describe("Roles: existing accounts and email invitations", () => {
  it("selects an existing account by email before direct assignment", async () => {
    renderWithProviders(<RolesScreen actingAdminUserId={actorId} />);
    await userEvent.type(screen.getByLabelText(t("roles.targetLabel")), "ana@");
    await userEvent.click(screen.getByRole("button", { name: t("users.searchCta") }));
    await userEvent.click(
      await screen.findByRole("button", { name: t("userPicker.choose", { email: user.email }) }),
    );
    await userEvent.selectOptions(screen.getByLabelText(t("roles.roleLabel")), "support_agent");
    await userEvent.click(screen.getByRole("button", { name: t("roles.assign") }));
    expect(mocks.assignRole).toHaveBeenCalledWith({
      targetUserId: user.id,
      roleKey: "support_agent",
    });
  });
  it("invites an existing account with its profile and the selected email language, without granting a role immediately", async () => {
    renderWithProviders(<RolesScreen actingAdminUserId={actorId} />);
    await userEvent.click(screen.getByRole("button", { name: t("staff.add") }));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.click(dialog.getByLabelText(t("staff.recipientMode.existing")));
    await userEvent.type(dialog.getByLabelText(t("userPicker.searchLabel")), "ana@");
    await userEvent.click(dialog.getByRole("button", { name: t("users.searchCta") }));
    await userEvent.click(
      await dialog.findByRole("button", { name: t("userPicker.choose", { email: user.email }) }),
    );
    await waitFor(() => expect(dialog.getByLabelText(t("staff.firstName"))).toHaveValue("Ana"));
    expect(dialog.getByLabelText(t("users.colEmail"))).toHaveValue(user.email);
    await userEvent.selectOptions(
      dialog.getByLabelText(t("staff.colRole")),
      "professional_verifier",
    );
    await userEvent.selectOptions(dialog.getByLabelText(t("staff.emailLanguage")), "fr");
    await userEvent.click(dialog.getByRole("button", { name: t("staff.send") }));
    expect(mocks.inviteStaff).toHaveBeenCalledWith({
      firstName: "Ana",
      lastName: "Garcia",
      email: user.email,
      roleKey: "professional_verifier",
      locale: "fr",
    });
    expect(mocks.assignRole).not.toHaveBeenCalled();
  });
  it("invites an email that is not registered", async () => {
    renderWithProviders(<RolesScreen actingAdminUserId={actorId} />);
    await userEvent.click(screen.getByRole("button", { name: t("staff.add") }));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.type(dialog.getByLabelText(t("staff.firstName")), "Luis");
    await userEvent.type(dialog.getByLabelText(t("staff.lastName")), "Perez");
    await userEvent.type(dialog.getByLabelText(t("users.colEmail")), "Luis@Example.com");
    await userEvent.selectOptions(dialog.getByLabelText(t("staff.colRole")), "support_agent");
    await userEvent.click(dialog.getByRole("button", { name: t("staff.send") }));
    expect(mocks.inviteStaff).toHaveBeenCalledWith({
      firstName: "Luis",
      lastName: "Perez",
      email: "luis@example.com",
      roleKey: "support_agent",
      locale: "es",
    });
    expect(mocks.searchUsers).not.toHaveBeenCalled();
  });
  it("does not allow selecting the acting administrator", async () => {
    mocks.searchUsers.mockResolvedValue({ users: [{ ...user, id: actorId }], truncated: false });
    renderWithProviders(<RolesScreen actingAdminUserId={actorId} />);
    await userEvent.type(screen.getByLabelText(t("roles.targetLabel")), "ana@");
    await userEvent.click(screen.getByRole("button", { name: t("users.searchCta") }));
    expect(
      await screen.findByRole("button", { name: t("userPicker.choose", { email: user.email }) }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: t("roles.assign") })).toBeDisabled();
    expect(mocks.assignRole).not.toHaveBeenCalled();
  });
});
