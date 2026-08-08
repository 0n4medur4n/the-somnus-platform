import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Build-time internal link check (build plan §20 Checkpoint 9.2): every
 * internal href/src in the built site must resolve to a file that was
 * actually generated. Catches a mistyped route or a page that stopped
 * being emitted. External links (the SPA, mailto, anchors) are skipped.
 * Requires `astro build` first (CI runs it before this suite).
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

function internalRefs(html: string): string[] {
  const refs = new Set<string>();
  const re = /(?:href|src)\s*=\s*"([^"]+)"/g;
  let match: RegExpExecArray | null = re.exec(html);
  while (match !== null) {
    const raw = match[1] ?? "";
    match = re.exec(html);
    if (raw.length === 0) continue;
    if (/^(?:https?:|mailto:|tel:|data:|#)/i.test(raw)) continue;
    if (!raw.startsWith("/")) continue; // only site-absolute internal links
    refs.add(raw.split("#")[0]?.split("?")[0] ?? raw);
  }
  return [...refs];
}

/** Maps a site-absolute URL path to the dist file it should have produced. */
function resolveTarget(ref: string): string {
  if (ref.endsWith("/")) return join(distDir, ref, "index.html");
  if (/\.[a-z0-9]+$/i.test(ref)) return join(distDir, ref);
  // Extensionless, no trailing slash: Astro cleanUrls emits a directory.
  return join(distDir, ref, "index.html");
}

describe("build-time internal link check", () => {
  it("dist exists (run `astro build` first)", () => {
    expect(existsSync(distDir), `${distDir} not found -- build the site first`).toBe(true);
  });

  it("every internal link resolves to a generated file", () => {
    const pages = htmlFiles(distDir);
    expect(pages.length).toBeGreaterThan(0);

    const broken: string[] = [];
    for (const page of pages) {
      const html = readFileSync(page, "utf8");
      for (const ref of internalRefs(html)) {
        const target = resolveTarget(ref);
        if (!existsSync(target)) broken.push(`${page.replace(distDir, "")} -> ${ref}`);
      }
    }
    expect(broken, `broken internal links:\n${broken.join("\n")}`).toEqual([]);
  });
});
