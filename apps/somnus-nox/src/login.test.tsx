import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "./i18n/index.js";
import { Login } from "./routes/Login.js";

const { sendLoginLink } = vi.hoisted(() => ({ sendLoginLink: vi.fn() }));

vi.mock("./auth/firebase-auth.js", () => ({
  sendLoginLink,
}));

const t = (key: string, vars?: Record<string, string>) => i18n.t(key, vars ?? {});

describe("magic-link login", () => {
  beforeEach(() => {
    sendLoginLink.mockReset();
    sendLoginLink.mockResolvedValue(undefined);
  });

  it("sends a sign-in link for the typed address", async () => {
    const user = userEvent.setup();
    render(<Login />);
    await user.type(screen.getByLabelText(t("login.emailLabel")), "medic@example.com");
    await user.click(screen.getByRole("button", { name: t("login.sendLink") }));
    expect(sendLoginLink).toHaveBeenCalledWith("medic@example.com");
    expect(await screen.findByRole("status")).toHaveTextContent("medic@example.com");
  });
});
