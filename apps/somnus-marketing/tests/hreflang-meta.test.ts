import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * hreflang + SEO metadata check (build plan §20 Checkpoint 9.2: "SEO
 * metadata + hreflang for four locales"). Asserts the built pages carry a
 * complete set of alternates (the four locales + x-default), a canonical,
 * and the Open Graph / Twitter tags -- the signals search engines and
 * link unfurlers rely on. Reads dist, so `astro build` must run first.
 */
const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const LOCALES = ["es", "en", "ca", "fr"] as const;

function head(page: string): string {
  const file = `${distDir}/${page}`;
  return readFileSync(file, "utf8");
}

describe("hreflang + SEO metadata", () => {
  it("dist exists (run `astro build` first)", () => {
    expect(existsSync(distDir)).toBe(true);
  });

  it("the home page has an hreflang alternate for every locale + x-default", () => {
    const html = head("es/index.html");
    for (const locale of LOCALES) {
      expect(html, `missing hreflang=${locale}`).toContain(`hreflang="${locale}"`);
    }
    expect(html, "missing hreflang=x-default").toContain('hreflang="x-default"');
  });

  it("has canonical, Open Graph, and Twitter card metadata", () => {
    const html = head("es/index.html");
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain('property="og:url"');
    expect(html).toContain('name="twitter:card"');
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toContain('name="description"');
  });

  it("localized pages point their canonical at their own locale", () => {
    for (const locale of LOCALES) {
      const html = head(`${locale}/pricing/index.html`);
      expect(html, `${locale} pricing canonical`).toMatch(
        new RegExp(`rel="canonical"\\s+href="[^"]*/${locale}/pricing/?"`),
      );
    }
  });
});
