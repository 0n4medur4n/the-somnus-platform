import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "../auth/AuthContext.js";
import { i18n, renderWithProviders } from "../test/utils.js";

const { patchProfile } = vi.hoisted(() => ({ patchProfile: vi.fn() }));
vi.mock("../lib/edge.js", () => ({ edge: { patchProfile } }));

const { Profile } = await import("./Profile.js");

const authValue: AuthContextValue = {
  state: {
    status: "authenticated",
    me: {
      user: { id: "u", email: "u@example.com", locale: "es", status: "active" },
      individualProfile: { firstName: "Ada", lastName: "Lovelace" },
      professionalProfile: null,
    },
  },
  refresh: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn(),
};

describe("Profile (component test for a form)", () => {
  beforeEach(() => patchProfile.mockReset());

  it("prefills from the current profile, saves changes, and announces success", async () => {
    patchProfile.mockResolvedValue(undefined);
    renderWithProviders(<Profile />, { auth: authValue });

    const first = screen.getByLabelText(i18n.t("profile.firstName"));
    expect(first).toHaveValue("Ada");

    await userEvent.clear(first);
    await userEvent.type(first, "Grace");
    await userEvent.click(screen.getByRole("button", { name: i18n.t("common.save") }));

    await waitFor(() =>
      expect(patchProfile).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: "Grace", lastName: "Lovelace" }),
      ),
    );
    expect(await screen.findByText(i18n.t("profile.saved"))).toBeInTheDocument();
  });
});
