import { describe, expect, it } from "vitest";
import { BRAND_TOKENS, tokensAsCssVariables, tokensAsJson } from "./tokens.js";

describe("BRAND_TOKENS (build plan §4)", () => {
  it("exposes the documented color palette", () => {
    expect(BRAND_TOKENS.color.background).toBe("#090d1a");
    expect(BRAND_TOKENS.color.surface).toBe("#141c33");
    expect(BRAND_TOKENS.color.primary).toBe("#437ef7");
    expect(BRAND_TOKENS.color.text).toBe("#e2e8f0");
    expect(BRAND_TOKENS.color.muted).toBe("#64748b");
  });

  it("exposes a documented font fallback stack", () => {
    expect(BRAND_TOKENS.font.stack).toContain("Inter");
    expect(BRAND_TOKENS.font.stack).toContain("system-ui");
  });

  it("is fully frozen (no mutation possible at runtime)", () => {
    expect(Object.isFrozen(BRAND_TOKENS)).toBe(true);
    expect(Object.isFrozen(BRAND_TOKENS.color)).toBe(true);
  });
});

describe("tokensAsCssVariables", () => {
  it("emits a :root block with all tokens", () => {
    const css = tokensAsCssVariables();
    expect(css).toMatch(/^:root \{/);
    expect(css).toContain("--somnus-color-background: #090d1a;");
    expect(css).toContain("--somnus-color-primary: #437ef7;");
    expect(css).toContain("--somnus-font-stack:");
    expect(css).toMatch(/\}\s*$/);
  });

  it("respects a custom prefix", () => {
    const css = tokensAsCssVariables("brand");
    expect(css).toContain("--brand-color-background:");
  });
});

describe("tokensAsJson", () => {
  it("returns a JSON string that round-trips to the same structure", () => {
    const j = JSON.parse(tokensAsJson());
    expect(j.color.background).toBe("#090d1a");
    expect(j.font.stack).toContain("Inter");
  });
});
