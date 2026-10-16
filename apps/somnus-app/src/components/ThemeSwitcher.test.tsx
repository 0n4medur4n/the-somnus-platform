import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { i18n, renderWithProviders } from "../test/utils.js";
import { applyTheme, storedTheme } from "../theme.js";
import { ThemeSwitcher } from "./ThemeSwitcher.js";

describe("ThemeSwitcher", () => {
  afterEach(() => {
    localStorage.clear();
    applyTheme("dark");
  });

  it("is dark by default, and switches the whole page to light or high contrast, remembering it", async () => {
    renderWithProviders(<ThemeSwitcher />);
    const select = screen.getByRole("combobox", { name: i18n.t("common.theme") });
    expect(select).toHaveValue("dark");
    expect(document.documentElement).not.toHaveAttribute("data-theme");

    await userEvent.selectOptions(select, "light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(storedTheme()).toBe("light");

    await userEvent.selectOptions(select, "contrast");
    expect(document.documentElement).toHaveAttribute("data-theme", "contrast");

    await userEvent.selectOptions(select, "dark");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("falls back to dark when nothing (or something unknown) is stored", () => {
    localStorage.setItem("somnus_theme", "neon");
    expect(storedTheme()).toBe("dark");
  });
});
