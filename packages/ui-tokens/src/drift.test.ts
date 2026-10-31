import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  expectedScaleTokens,
  readScaleOverrides,
  readSharedThemeTokens,
  tokenDiff,
} from "./parse-tokens.js";
import {
  colorDeclarations,
  UI_COLOR_NAMES,
  UI_COLOR_TOKENS,
  UI_FONT_SANS,
  type UiThemeName,
} from "./tokens.js";

const appCssPath = fileURLToPath(
  new URL("../../../apps/somnus-app/src/index.css", import.meta.url),
);
const packageCssPath = fileURLToPath(new URL("./theme.css", import.meta.url));

function expectedTheme(theme: UiThemeName, includeFont: boolean): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of UI_COLOR_NAMES) {
    values[`--color-somnus-${name}`] = UI_COLOR_TOKENS[theme][name];
  }
  if (includeFont) values["--font-sans"] = UI_FONT_SANS;
  return values;
}

describe("SPA token drift", () => {
  const appCss = readFileSync(appCssPath, "utf8");
  const packageCss = readFileSync(packageCssPath, "utf8");
  const appTokens = readSharedThemeTokens(appCss);
  const packageTokens = readSharedThemeTokens(packageCss);

  it("matches every shared token in apps/somnus-app/src/index.css", () => {
    expect(tokenDiff(packageTokens.dark, appTokens.dark)).toEqual([]);
    expect(tokenDiff(packageTokens.light, appTokens.light)).toEqual([]);
    expect(tokenDiff(packageTokens.contrast, appTokens.contrast)).toEqual([]);
  });

  it("matches the typed token table, including Inter on the dark theme only", () => {
    expect(tokenDiff(packageTokens.dark, expectedTheme("dark", true))).toEqual([]);
    expect(tokenDiff(packageTokens.light, expectedTheme("light", false))).toEqual([]);
    expect(tokenDiff(packageTokens.contrast, expectedTheme("contrast", false))).toEqual([]);
  });

  it("does not override the Tailwind spacing or radius scale", () => {
    expect(readScaleOverrides(appCss)).toEqual({});
    expect(readScaleOverrides(packageCss)).toEqual({});
  });

  it("records the Tailwind 4 spacing base and radius steps", () => {
    const scale = expectedScaleTokens();
    expect(scale["--spacing"]).toBe("0.25rem");
    expect(scale["--radius-md"]).toBe("0.375rem");
    expect(scale["--radius-2xl"]).toBe("1rem");
  });

  it("fails closed when a theme block is missing or unclosed", () => {
    expect(() => readSharedThemeTokens(":root { --color-somnus-text: #fff; }")).toThrow(
      /Missing CSS block/,
    );
    expect(() => readSharedThemeTokens("@theme")).toThrow(/Missing CSS block body/);
    expect(() => readSharedThemeTokens("@theme {")).toThrow(/Unclosed CSS block/);
  });

  it("ignores tokens that appear only inside comments", () => {
    const css = `${appCss}\n/* --color-somnus-text: #000000; --spacing: 9rem; */`;
    expect(tokenDiff(readSharedThemeTokens(css).dark, appTokens.dark)).toEqual([]);
    expect(readScaleOverrides(css)).toEqual({});
  });

  it("reports a spacing override and a missing token on either side", () => {
    expect(readScaleOverrides("--spacing: 9rem; --radius-md: 2px;")).toEqual({
      "--spacing": "9rem",
      "--radius-md": "2px",
    });
    expect(tokenDiff({ "--color-somnus-text": "#fff" }, {})).toEqual([
      "--color-somnus-text: #fff !== missing",
    ]);
    expect(tokenDiff({}, { "--font-sans": "Inter" })).toEqual(["--font-sans: missing !== Inter"]);
  });

  it("reports a shared value that no longer matches the app stylesheet", () => {
    const tweaked = appCss.replace("#090d1a", "#000000");
    expect(tokenDiff(readSharedThemeTokens(tweaked).dark, appTokens.dark).length).toBeGreaterThan(
      0,
    );
  });

  it("prints the dark color and font declarations", () => {
    const printed = colorDeclarations("dark", true);
    expect(printed).toContain("--color-somnus-background: #090d1a;");
    expect(printed).toContain(`--font-sans: ${UI_FONT_SANS};`);
    expect(colorDeclarations("light", false)).not.toContain("--font-sans");
  });

  it("records the same spacing and radius as the installed Tailwind 4 theme", () => {
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    const candidates = [
      join(root, "apps/somnus-app/node_modules/tailwindcss/theme.css"),
      join(root, "apps/somnus-nox/node_modules/tailwindcss/theme.css"),
      join(root, "node_modules/tailwindcss/theme.css"),
    ];
    const themePath = candidates.find((candidate) => existsSync(candidate));
    if (themePath === undefined) {
      throw new Error(`tailwindcss/theme.css not found:\n${candidates.join("\n")}`);
    }
    const installed = scaleFromTailwindTheme(readFileSync(themePath, "utf8"));
    expect(installed).toEqual(expectedScaleTokens());
  });
});

/** `--spacing` and `--radius-*` from Tailwind's own theme.css. */
function scaleFromTailwindTheme(css: string): Record<string, string> {
  const found: Record<string, string> = {};
  const spacing = css.match(/--spacing:\s*([^;]+);/);
  const spacingValue = spacing?.[1];
  if (spacingValue !== undefined) found["--spacing"] = spacingValue.trim();
  for (const match of css.matchAll(/--radius-([A-Za-z0-9-]+):\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    found[`--radius-${name}`] = value.trim();
  }
  return found;
}
