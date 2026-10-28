import { TAILWIND_V4_RADIUS, TAILWIND_V4_SPACING } from "./tokens.js";

export type TokenMap = Readonly<Record<string, string>>;

export type SharedThemeTokens = {
  readonly dark: TokenMap;
  readonly light: TokenMap;
  readonly contrast: TokenMap;
};

export function normalizeTokenValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function blockAfter(css: string, marker: string): string {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`Missing CSS block: ${marker}`);
  const open = css.indexOf("{", start);
  if (open < 0) throw new Error(`Missing CSS block body: ${marker}`);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    const char = css[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`Unclosed CSS block: ${marker}`);
}

function sharedProps(block: string): TokenMap {
  const found: Record<string, string> = {};
  const sharedProp = /--(color-somnus-[a-z0-9-]+|font-sans)\s*:\s*([^;]+);/g;
  for (const match of block.matchAll(sharedProp)) {
    found[`--${String(match[1])}`] = normalizeTokenValue(String(match[2]));
  }
  return found;
}

/** Color and font tokens from the three theme blocks the SPA stylesheet uses. */
export function readSharedThemeTokens(css: string): SharedThemeTokens {
  const source = stripComments(css);
  return {
    dark: sharedProps(blockAfter(source, "@theme")),
    light: sharedProps(blockAfter(source, ':root[data-theme="light"]')),
    contrast: sharedProps(blockAfter(source, ':root[data-theme="contrast"]')),
  };
}

export function tokenDiff(left: TokenMap, right: TokenMap): string[] {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const diffs: string[] = [];
  for (const key of [...keys].sort()) {
    if (left[key] !== right[key]) {
      diffs.push(`${key}: ${left[key] ?? "missing"} !== ${right[key] ?? "missing"}`);
    }
  }
  return diffs;
}

/**
 * Custom spacing or radius declarations. An empty result means the file
 * keeps the Tailwind CSS 4 default scale.
 */
export function readScaleOverrides(css: string): TokenMap {
  const found: Record<string, string> = {};
  const scaleProp = /--(spacing|radius-[a-z0-9-]+)\s*:\s*([^;]+);/g;
  for (const match of stripComments(css).matchAll(scaleProp)) {
    found[`--${String(match[1])}`] = normalizeTokenValue(String(match[2]));
  }
  return found;
}

export function expectedScaleTokens(): TokenMap {
  return {
    "--spacing": TAILWIND_V4_SPACING,
    ...Object.fromEntries(
      Object.entries(TAILWIND_V4_RADIUS).map(([name, value]) => [`--radius-${name}`, value]),
    ),
  };
}
