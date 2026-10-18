import type { StaffInvitation } from "@somnus/api-contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../test/utils.js";

const PENDING: StaffInvitation = {
  id: "018f0000-0000-7000-8000-000000000101",
  firstName: "Luis",
  lastName: "Pérez",
  email: "luis@example.com",
  roleKey: "professional_verifier",
  locale: "es",
  status: "pending",
  invitedBy: "018f0000-0000-7000-8000-000000000abc",
  createdAt: "2026-10-18T10:00:00.000Z",
  expiresAt: "2026-10-25T10:00:00.000Z",
  acceptedAt: null,
};

const mocks = vi.hoisted(() => ({
  staffInvitations: vi.fn(),
  inviteStaff: vi.fn(),
  revokeStaffInvitation: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({ edge: mocks }));

const { StaffInvitations } = await import("./StaffInvitations.js");
const t = i18n.t.bind(i18n);

describe("StaffInvitations", () => {
  beforeEach(() => {
    mocks.staffInvitations.mockReset().mockResolvedValue({ invitations: [PENDING] });
    mocks.inviteStaff.mockReset();
    mocks.revokeStaffInvitation.mockReset().mockResolvedValue({ ...PENDING, status: "revoked" });
  });

  it("lists invitations with name, address, role and status", async () => {
    renderWithProviders(<StaffInvitations />);
    const table = await screen.findByTestId("staff-invitations");
    const row = within(table).getAllByRole("row")[1] as HTMLElement;
    expect(row).toHaveTextContent("Luis Pérez");
    expect(row).toHaveTextContent("luis@example.com");
    expect(row).toHaveTextContent(t("role.professional_verifier"));
    expect(row).toHaveTextContent(t("staff.status.pending"));
  });

  it("invites with name, surname, address and role, and says the email went out", async () => {
    mocks.inviteStaff.mockResolvedValue({
      invitation: { ...PENDING, firstName: "Ana", email: "ana@example.com" },
      emailSent: true,
    });
    renderWithProviders(<StaffInvitations />);
    await userEvent.click(await screen.findByRole("button", { name: t("staff.add") }));

    const send = screen.getByRole("button", { name: t("staff.send") });
    expect(send).toBeDisabled();

    await userEvent.type(screen.getByLabelText(t("staff.firstName")), "Ana");
    await userEvent.type(screen.getByLabelText(t("staff.lastName")), "García López");
    await userEvent.type(screen.getByLabelText(t("users.colEmail")), "Ana@Example.com");
    await userEvent.selectOptions(screen.getByLabelText(t("staff.colRole")), "support_agent");
    await userEvent.click(send);

    expect(mocks.inviteStaff).toHaveBeenCalledWith({
      firstName: "Ana",
      lastName: "García López",
      email: "ana@example.com",
      roleKey: "support_agent",
      locale: "es",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      t("staff.sent", { email: "ana@example.com" }),
    );
  });

  it("says plainly when the invitation was saved but the email was not sent", async () => {
    mocks.inviteStaff.mockResolvedValue({ invitation: PENDING, emailSent: false });
    renderWithProviders(<StaffInvitations />);
    const table = await screen.findByTestId("staff-invitations");
    await userEvent.click(within(table).getByRole("button", { name: t("staff.resend") }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      t("staff.savedNotSent", { email: "luis@example.com" }),
    );
  });

  it("withdraws a pending invitation", async () => {
    renderWithProviders(<StaffInvitations />);
    const table = await screen.findByTestId("staff-invitations");
    await userEvent.click(within(table).getByRole("button", { name: t("staff.revoke") }));
    await waitFor(() => expect(mocks.revokeStaffInvitation).toHaveBeenCalledWith(PENDING.id));
  });
});
