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
});
