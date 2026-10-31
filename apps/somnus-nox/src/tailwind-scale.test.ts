import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { TAILWIND_V4_RADIUS, TAILWIND_V4_SPACING } from "@somnus/ui-tokens";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("Tailwind 4 default scale", () => {
  it("matches the spacing base and radius steps shipped with tailwindcss", () => {
    const themePath = require.resolve("tailwindcss/theme.css");
    const theme = readFileSync(themePath, "utf8");
    expect(theme).toContain(`--spacing: ${TAILWIND_V4_SPACING};`);
    for (const [name, value] of Object.entries(TAILWIND_V4_RADIUS)) {
      expect(theme, name).toContain(`--radius-${name}: ${value};`);
    }
  });
});
