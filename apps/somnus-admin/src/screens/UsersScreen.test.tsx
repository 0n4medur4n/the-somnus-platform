import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../test/utils.js";
import { UsersScreen } from "./UsersScreen.js";

const searchUsers = vi.fn(async () => ({
  users: [
    {
      id: "0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      email: "ana@example.com",
      locale: "es" as const,
      status: "active" as const,
      createdAt: "2026-10-01T09:00:00.000Z",
    },
    {
      id: "0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
      email: "luis@example.com",
      locale: "es" as const,
      status: "suspended" as const,
      createdAt: "2026-10-02T09:00:00.000Z",
    },
  ],
  truncated: false,
}));

const userDetail = vi.fn(async () => ({
  user: {
    id: "0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
    email: "ana@example.com",
    locale: "ca",
    status: "active",
    createdAt: "2026-10-01T09:00:00.000Z",
  },
  individualProfile: {
    firstName: "Ana",
    lastName: "Garcia",
    registrationRole: "professional",
    dateOfBirth: "1990-05-17",
    phone: "+34600000000",
    country: "ES",
    city: "Barcelona",
    gender: "female",
  },
  professionalProfile: {
    specialty: "family_physician",
    verificationStatus: "pending",
    licenseNumber: "TEST-123",
  },
  internalRoles: [],
  organizationIds: ["org-1"],
  roleAssignments: [
    {
      roleKey: "organization_admin",
      organizationId: "org-1",
      assignedAt: "2026-10-02T09:00:00.000Z",
    },
  ],
  organizations: [
    { id: "org-1", name: "Organización de prueba", status: "active", membershipStatus: "inactive" },
  ],
}));
vi.mock("../lib/edge.js", () => ({
  edge: {
    searchUsers: (...a: []) => searchUsers(...a),
    userDetail: (...a: []) => userDetail(...a),
  },
}));

const t = i18n.t.bind(i18n);

describe("UsersScreen", () => {
  it("shows administrative contact, membership and scoped roles with translated verification", async () => {
    renderWithProviders(<UsersScreen canChangeStatus={false} />);
    const table = await screen.findByTestId("user-results");
    const first = within(table).getAllByRole("row")[1];
    if (!first) throw new Error("Missing fixture row");
    await userEvent.click(within(first).getByRole("button", { name: t("users.view") }));
    const detail = await screen.findByTestId("user-detail");
    expect(within(detail).getByText("Ana Garcia")).toBeInTheDocument();
    expect(within(detail).getByText("TEST-123")).toBeInTheDocument();
    expect(within(detail).getByText("+34600000000")).toBeInTheDocument();
    expect(
      within(detail).getByText(new RegExp(t("metadata.verification.pending"))),
    ).toBeInTheDocument();
    expect(within(detail).getByText(new RegExp(t("role.organization_admin")))).toHaveTextContent(
      "Organización de prueba",
    );
    expect(
      within(detail).getByText(new RegExp(t("metadata.membership.inactive"))),
    ).toBeInTheDocument();
  });
  it("lists the accounts as soon as it opens, without a search", async () => {
    renderWithProviders(<UsersScreen canChangeStatus={false} />);

    const table = await screen.findByTestId("user-results");
    expect(searchUsers).toHaveBeenCalledWith({ limit: 100 });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
      "ana@example.com",
      "luis@example.com",
    ]);
    expect(within(rows[1] as HTMLElement).getByText(t("status.suspended"))).toBeInTheDocument();
  });
});
