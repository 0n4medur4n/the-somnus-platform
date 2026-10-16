import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../test/utils.js";

const { sendLoginLink } = vi.hoisted(() => ({ sendLoginLink: vi.fn() }));
vi.mock("../auth/firebase-auth.js", () => ({ sendLoginLink }));

const { Login } = await import("./Login.js");

describe("Login (component test for auth form)", () => {
  beforeEach(() => sendLoginLink.mockReset());

  it("shows a validation error and does not submit when the email is empty", async () => {
    renderWithProviders(<Login />);
    await userEvent.click(screen.getByRole("button", { name: i18n.t("login.sendLink") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("errors.summaryTitle"));
    expect(sendLoginLink).not.toHaveBeenCalled();
  });

  it("sends the sign-in link and confirms it for a valid email", async () => {
    sendLoginLink.mockResolvedValue(undefined);
    renderWithProviders(<Login />);
    await userEvent.type(screen.getByLabelText(i18n.t("login.emailLabel")), "user@example.com");
    await userEvent.click(screen.getByRole("button", { name: i18n.t("login.sendLink") }));
    await waitFor(() => expect(sendLoginLink).toHaveBeenCalledWith("user@example.com"));
    expect(await screen.findByRole("status")).toHaveTextContent("user@example.com");
  });

  it("shows that it is sending while the link is on its way, and says so if it takes a while", async () => {
    let finish: () => void = () => {};
    sendLoginLink.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    renderWithProviders(<Login />);
    await userEvent.type(screen.getByLabelText(i18n.t("login.emailLabel")), "user@example.com");
    await userEvent.click(screen.getByRole("button", { name: i18n.t("login.sendLink") }));

    const button = await screen.findByRole("button", { name: i18n.t("login.sending") });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(
      await screen.findByText(i18n.t("login.sendingSlow"), {}, { timeout: 4000 }),
    ).toBeInTheDocument();

    finish();
    expect(await screen.findByText(/user@example\.com/)).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("login.sendingSlow"))).not.toBeInTheDocument();
  });
});
