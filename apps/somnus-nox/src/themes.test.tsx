import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UI_COLOR_TOKENS, UI_FONT_SANS } from "@somnus/ui-tokens";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Gate } from "./App.js";
import { NoxAuthProvider } from "./auth/NoxAuthProvider.js";

const themeCss = readFileSync(
  join(process.cwd(), "../../packages/ui-tokens/src/theme.css"),
  "utf8",
);

const GRANT = { verifiedProfessional: true, noxAccess: true };

function background(): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--color-somnus-background")
    .trim()
    .toLowerCase();
}

describe("the three themes render with the shared tokens", () => {
  beforeEach(() => {
    const style = document.createElement("style");
    style.setAttribute("data-testid", "ui-tokens");
    style.textContent = themeCss;
    document.head.appendChild(style);
  });

  it("dark, light and high contrast use the shared palette and Inter", async () => {
    const user = userEvent.setup();
    render(
      <NoxAuthProvider session="signed-in" reader={async () => GRANT}>
        <Gate />
      </NoxAuthProvider>,
    );
    expect(await screen.findByTestId("nox-module-list")).toBeInTheDocument();
    expect(themeCss).toContain(UI_FONT_SANS);
    expect(background()).toBe(UI_COLOR_TOKENS.dark.background);

    await user.selectOptions(screen.getByRole("combobox", { name: "Apariencia" }), "light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(background()).toBe(UI_COLOR_TOKENS.light.background);

    await user.selectOptions(screen.getByRole("combobox", { name: "Apariencia" }), "contrast");
    expect(document.documentElement.getAttribute("data-theme")).toBe("contrast");
    expect(background()).toBe(UI_COLOR_TOKENS.contrast.background);

    await user.selectOptions(screen.getByRole("combobox", { name: "Apariencia" }), "dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(background()).toBe(UI_COLOR_TOKENS.dark.background);
  });
});
