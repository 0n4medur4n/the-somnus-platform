/**
 * Product UI tokens copied from apps/somnus-app/src/index.css.
 *
 * These are not the marketing brand tokens in @somnus/design-system
 * (Satoshi, Okine, a single palette, --somnus-* names). The SPAs use
 * Inter, three themes, and the Tailwind CSS 4 spacing and radius scale.
 */

export const UI_FONT_SANS =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const UI_COLOR_NAMES = [
  "background",
  "surface",
  "primary",
  "primary-strong",
  "text",
  "muted",
  "subtle",
  "danger",
  "success",
] as const;

export type UiColorName = (typeof UI_COLOR_NAMES)[number];
export type UiColorTokens = Readonly<Record<UiColorName, string>>;

export const UI_COLOR_TOKENS = Object.freeze({
  dark: Object.freeze({
    background: "#090d1a",
    surface: "#141c33",
    primary: "#437ef7",
    "primary-strong": "#2f6ae0",
    text: "#e2e8f0",
    muted: "#64748b",
    subtle: "#9fb0c3",
    danger: "#f87171",
    success: "#4ade80",
  }),
  light: Object.freeze({
    background: "#f4f6fb",
    surface: "#ffffff",
    primary: "#2f6ae0",
    "primary-strong": "#1d4ed8",
    text: "#0f172a",
    muted: "#94a3b8",
    subtle: "#475569",
    danger: "#b91c1c",
    success: "#15803d",
  }),
  contrast: Object.freeze({
    background: "#ffffff",
    surface: "#ffffff",
    primary: "#0033a0",
    "primary-strong": "#0033a0",
    text: "#000000",
    muted: "#1f2937",
    subtle: "#1f2937",
    danger: "#9b0000",
    success: "#0b5d1e",
  }),
} satisfies Record<"dark" | "light" | "contrast", UiColorTokens>);

export type UiThemeName = keyof typeof UI_COLOR_TOKENS;

/**
 * Tailwind CSS 4 defaults. somnus-app does not override them; utilities
 * such as p-4, gap-4, rounded-md and rounded-2xl use this scale.
 * --spacing is the single base; every step is a multiple of it.
 */
export const TAILWIND_V4_SPACING = "0.25rem";

export const TAILWIND_V4_RADIUS = Object.freeze({
  xs: "0.125rem",
  sm: "0.25rem",
  md: "0.375rem",
  lg: "0.5rem",
  xl: "0.75rem",
  "2xl": "1rem",
  "3xl": "1.5rem",
  "4xl": "2rem",
});

export function colorDeclarations(theme: UiThemeName, includeFont: boolean): string {
  const lines = UI_COLOR_NAMES.map(
    (name) => `  --color-somnus-${name}: ${UI_COLOR_TOKENS[theme][name]};`,
  );
  if (includeFont) lines.push(`  --font-sans: ${UI_FONT_SANS};`);
  return lines.join("\n");
}
