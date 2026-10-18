import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AdminAuthContextValue } from "../auth/AdminAuthContext.js";
import { i18n, renderWithProviders } from "../test/utils.js";

const acceptStaffInvitation = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/edge.js", () => ({ edge: { acceptStaffInvitation } }));

const { Invited } = await import("./Invited.js");
const t = i18n.t.bind(i18n);

const INVITATION = {
  firstName: "Ana",
  roleKey: "support_agent",
  expiresAt: "2026-10-25T12:00:00.000Z",
} as const;

describe("Invited", () => {
  it("accepts only after the privacy policy is acknowledged, then re-reads the gate", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const auth: AdminAuthContextValue = {
      state: { status: "invited", invitation: INVITATION },
      refresh,
      logout: vi.fn(),
    };
    renderWithProviders(<Invited invitation={INVITATION} />, { auth });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      t("invited.title", { name: "Ana" }),
    );
    expect(screen.getByText(t("invited.body", { role: t("role.support_agent") }))).toBeVisible();

    const accept = screen.getByRole("button", { name: t("invited.accept") });
    expect(accept).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(accept);

    await waitFor(() => expect(acceptStaffInvitation).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
