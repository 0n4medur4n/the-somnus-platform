import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  completePolicy,
  decodeAttribute,
  inlineScripts,
  inlineStyles,
  sha256,
  styleAttributeValues,
} from "../scripts/csp-hashes.mjs";

/**
 * Content-Security-Policy of the marketing site.
 *
 * The header (firebase.json) carries the directives that do not depend on the
 * page; the page's own <meta> carries script-src and style-src with the hash of
 * everything inline. Neither may contain 'unsafe-inline' or 'unsafe-eval', and
 * every inline script, <style> and style="" attribute of every built page must
 * be covered, or the browser would block it. Requires `astro build` first.
 */
const distDir = fileURLToPath(new URL("../dist", import.meta.url));

function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (full.endsWith(".html")) out.push(full);
  }
  return out;
}

function policyOf(html: string): Map<string, string[]> {
  const match = /<meta\s+http-equiv="content-security-policy"\s+content="([^"]*)"/i.exec(html);
  if (!match) throw new Error("no <meta> Content-Security-Policy");
  return new Map(
    (match[1] ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name = "", ...sources] = part.split(/\s+/);
        return [name, sources] as const;
      }),
  );
}

const pages = htmlFiles(distDir);

describe("marketing CSP (built pages)", () => {
  it("builds pages", () => {
    expect(pages.length).toBeGreaterThan(10);
  });

  it.each(pages.map((page) => [page.slice(distDir.length), page] as const))(
    "%s is covered by its policy",
    (_name, page) => {
      const html = readFileSync(page, "utf8");
      const policy = policyOf(html);

      const everything = [...policy.values()].flat().join(" ");
      expect(everything).not.toContain("'unsafe-inline'");
      expect(everything).not.toContain("'unsafe-eval'");

      const scriptSrc = policy.get("script-src") ?? [];
      expect(scriptSrc).toContain("'self'");
      const styleSrc = policy.get("style-src") ?? [];
      expect(styleSrc).toContain("'self'");

      for (const code of inlineScripts(html)) {
        expect(scriptSrc, `inline script not hashed: ${code.slice(0, 60)}`).toContain(sha256(code));
      }
      for (const css of inlineStyles(html)) {
        expect(styleSrc, `<style> not hashed: ${css.slice(0, 60)}`).toContain(sha256(css));
      }
      const attributeSrc = policy.get("style-src-attr") ?? [];
      for (const value of styleAttributeValues(html)) {
        expect(attributeSrc, `style="" not hashed: ${value.slice(0, 60)}`).toContain(sha256(value));
      }
      if (attributeSrc.length > 0) expect(attributeSrc).toContain("'unsafe-hashes'");

      // No inline event handlers or javascript: URLs, which hashes cannot cover.
      expect(html).not.toMatch(/\son[a-z]+="/i);
      expect(html).not.toMatch(/href="javascript:/i);
    },
  );
});

describe("completing a page's policy", () => {
  const policy = "script-src 'self'; style-src 'self';";
  const page = (body: string) =>
    `<html><head><meta http-equiv="content-security-policy" content="${policy}"></head><body>${body}</body></html>`;

  it("decodes the entities the build writes", () => {
    expect(decodeAttribute("--m:url(&quot;/a.svg&quot;)")).toBe('--m:url("/a.svg")');
    expect(decodeAttribute("a&amp;b")).toBe("a&b");
  });

  it("adds a hash for the exact style value, without unsafe-inline", () => {
    const out = completePolicy(page('<p style="opacity:0">x</p>'));
    expect(out).toContain(`style-src-attr 'unsafe-hashes' ${sha256("opacity:0")}`);
    expect(out).not.toContain("unsafe-inline");
  });

  it("hashes an is:inline script that Astro left out", () => {
    const out = completePolicy(page("<script>window.lock=1</script>"));
    expect(out).toContain(`script-src 'self' ${sha256("window.lock=1")}`);
    expect(out).not.toContain("unsafe-inline");
  });

  it("hashes a <style> element", () => {
    const out = completePolicy(page("<style>p{margin:0}</style>"));
    expect(out).toContain(`style-src 'self' ${sha256("p{margin:0}")}`);
  });

  it("does not hash an external script or a JSON data block", () => {
    const body = '<script src="/a.js"></script><script type="application/ld+json">{}</script>';
    expect(completePolicy(page(body))).toBe(page(body));
  });

  it("a value that was not in the build is not covered", () => {
    const out = completePolicy(page('<p style="opacity:0">x</p>'));
    expect(out).not.toContain(sha256("opacity:1"));
  });

  it("refuses a page that has inline code but no policy to extend", () => {
    expect(() => completePolicy('<p style="a:b">x</p>')).toThrow(/no <meta> CSP/);
  });
});
