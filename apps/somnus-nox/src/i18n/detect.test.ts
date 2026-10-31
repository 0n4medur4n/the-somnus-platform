import { afterEach, describe, expect, it, vi } from "vitest";
import i18n, { activeLocale, detectInitialLanguage } from "./index.js";

describe("detectInitialLanguage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("prefers an explicit lng query", () => {
    window.history.pushState({}, "", "/?lng=ca");
    expect(detectInitialLanguage()).toBe("ca");
  });

  it("uses the browser language when it is supported", () => {
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("fr-FR");
    expect(detectInitialLanguage()).toBe("fr");
  });

  it("falls back to es", () => {
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("de-DE");
    expect(detectInitialLanguage()).toBe("es");
    expect(activeLocale()).toBe("es");
  });

  it("activeLocale falls back when the resolved language is not supported", () => {
    vi.spyOn(i18n, "resolvedLanguage", "get").mockReturnValue("de");
    expect(activeLocale()).toBe("es");
  });
});
