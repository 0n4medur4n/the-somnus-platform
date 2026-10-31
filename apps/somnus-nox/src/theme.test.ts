import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, saveTheme, storedTheme } from "./theme.js";

describe("theme", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("uses dark when nothing is stored", () => {
    expect(storedTheme()).toBe("dark");
  });

  it("applies light and contrast as data-theme, and dark by removing it", () => {
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    applyTheme("contrast");
    expect(document.documentElement.getAttribute("data-theme")).toBe("contrast");
    applyTheme("dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("remembers a stored theme and ignores unknown values", () => {
    saveTheme("contrast");
    expect(storedTheme()).toBe("contrast");
    localStorage.setItem("somnus_theme", "neon");
    expect(storedTheme()).toBe("dark");
  });

  it("keeps the visit theme when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveTheme("light")).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(storedTheme()).toBe("dark");
  });
});
