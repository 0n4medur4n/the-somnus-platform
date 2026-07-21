/**
 * Brand foundation from build plan §4.
 *
 * These tokens are the single source of truth for color, spacing,
 * and typography across the marketing site, the SPA, the report
 * templates, and any internal tool. Do not redefine them elsewhere.
 *
 * Typography falls back to a documented stack until the approved
 * brand web licences are confirmed (see §4).
 */

export const BRAND_NAME = "The Somnus" as const;
export const BRAND_INITIAL_PRODUCT = "Morpheo" as const;

export type BrandTokens = {
  readonly color: {
    readonly background: string;
    readonly surface: string;
    readonly primary: string;
    readonly text: string;
    readonly muted: string;
  };
  readonly font: {
    readonly stack: string;
  };
  readonly spacing: {
    readonly xs: string;
    readonly sm: string;
    readonly md: string;
    readonly lg: string;
    readonly xl: string;
  };
  readonly radius: {
    readonly sm: string;
    readonly md: string;
    readonly lg: string;
  };
};

export const BRAND_TOKENS: BrandTokens = Object.freeze({
  color: Object.freeze({
    background: "#090d1a",
    surface: "#141c33",
    primary: "#437ef7",
    text: "#e2e8f0",
    muted: "#64748b",
  }),
  font: Object.freeze({
    stack:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  }),
  spacing: Object.freeze({
    xs: "0.25rem",
    sm: "0.5rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2.5rem",
  }),
  radius: Object.freeze({
    sm: "4px",
    md: "8px",
    lg: "16px",
  }),
});

export function tokensAsCssVariables(prefix = "somnus"): string {
  const lines: string[] = [":root {"];
  lines.push(`  --${prefix}-color-background: ${BRAND_TOKENS.color.background};`);
  lines.push(`  --${prefix}-color-surface: ${BRAND_TOKENS.color.surface};`);
  lines.push(`  --${prefix}-color-primary: ${BRAND_TOKENS.color.primary};`);
  lines.push(`  --${prefix}-color-text: ${BRAND_TOKENS.color.text};`);
  lines.push(`  --${prefix}-color-muted: ${BRAND_TOKENS.color.muted};`);
  lines.push(`  --${prefix}-font-stack: ${BRAND_TOKENS.font.stack};`);
  lines.push(`  --${prefix}-spacing-xs: ${BRAND_TOKENS.spacing.xs};`);
  lines.push(`  --${prefix}-spacing-sm: ${BRAND_TOKENS.spacing.sm};`);
  lines.push(`  --${prefix}-spacing-md: ${BRAND_TOKENS.spacing.md};`);
  lines.push(`  --${prefix}-spacing-lg: ${BRAND_TOKENS.spacing.lg};`);
  lines.push(`  --${prefix}-spacing-xl: ${BRAND_TOKENS.spacing.xl};`);
  lines.push(`  --${prefix}-radius-sm: ${BRAND_TOKENS.radius.sm};`);
  lines.push(`  --${prefix}-radius-md: ${BRAND_TOKENS.radius.md};`);
  lines.push(`  --${prefix}-radius-lg: ${BRAND_TOKENS.radius.lg};`);
  lines.push("}");
  return lines.join("\n");
}

export function tokensAsJson(): string {
  return JSON.stringify(BRAND_TOKENS, null, 2);
}
