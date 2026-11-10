import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Finishes the per-page Content-Security-Policy after `astro build`.
 *
 * Astro's built-in CSP (astro.config.mjs, `security.csp`) writes a <meta>
 * policy per page with the hash of the inline <script> and <style> elements it
 * processed. It leaves three things out, and without `unsafe-inline` the
 * browser would block each of them:
 *
 *  - scripts written with `is:inline` (the page lock and theme scripts),
 *  - the redirect pages Astro generates for the root and for 404,
 *  - `style="..."` attributes (the hero's initial blur, the staggered delays and
 *    the logo masks), which need their own `style-src-attr` list.
 *
 * This step reads the built page, hashes each of those exactly as shipped and
 * adds the hash to the page's own policy. Only what the build produced is
 * allowed: a script or attribute injected later does not match and stays
 * blocked, and nothing here is `unsafe-inline` or `unsafe-eval`. It follows the
 * markup by itself when a component changes.
 */

const ENTITIES = { "&quot;": '"', "&#34;": '"', "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">" };

/** The attribute value as the browser sees it, after HTML decoding. */
export function decodeAttribute(raw) {
  return raw
    .replace(/&(?:quot|#34|#39|apos|lt|gt);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

export function sha256(value) {
  return `'sha256-${createHash("sha256").update(value, "utf8").digest("base64")}'`;
}

const META = /(<meta\s+http-equiv="content-security-policy"\s+content=")([^"]*)(")/i;

/** Every distinct `style="..."` value in the page, decoded. */
export function styleAttributeValues(html) {
  const values = new Set();
  for (const match of html.matchAll(/<[a-z][^>]*?\sstyle="([^"]*)"/gi)) {
    values.add(decodeAttribute(match[1] ?? ""));
  }
  return [...values].filter((value) => value.length > 0);
}

/** The text of every executable inline <script> (data blocks such as JSON-LD never run). */
export function inlineScripts(html) {
  const out = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] ?? "";
    if (/\bsrc=/i.test(attrs) || /application\/(?:ld\+)?json/i.test(attrs)) continue;
    out.push(match[2] ?? "");
  }
  return out;
}

export function inlineStyles(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1] ?? "");
}

function parse(policy) {
  const map = new Map();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name, sources);
  }
  return map;
}

function serialize(map) {
  return `${[...map].map(([name, sources]) => [name, ...sources].join(" ")).join("; ")};`;
}

function addAll(map, name, sources, fallback) {
  const current = map.get(name) ?? fallback;
  for (const source of sources) if (!current.includes(source)) current.push(source);
  map.set(name, current);
}

/** The page with every inline script, <style> and style="" attribute covered by its policy. */
export function completePolicy(html) {
  const scripts = inlineScripts(html).map(sha256);
  const styles = inlineStyles(html).map(sha256);
  const attributes = styleAttributeValues(html).map(sha256);
  if (scripts.length + styles.length + attributes.length === 0) return html;
  if (!META.test(html)) throw new Error("page has inline code but no <meta> CSP to extend");
  return html.replace(META, (_, open, policy, close) => {
    const map = parse(policy);
    addAll(map, "script-src", scripts, ["'self'"]);
    addAll(map, "style-src", styles, ["'self'"]);
    if (attributes.length > 0) addAll(map, "style-src-attr", attributes, ["'unsafe-hashes'"]);
    return `${open}${serialize(map)}${close}`;
  });
}

async function htmlFiles(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...(await htmlFiles(path)));
    else if (entry.name.endsWith(".html")) out.push(path);
  }
  return out;
}

export async function applyToDirectory(directory) {
  let changed = 0;
  for (const file of await htmlFiles(directory)) {
    const before = await readFile(file, "utf8");
    const after = completePolicy(before);
    if (after !== before) {
      await writeFile(file, after);
      changed += 1;
    }
  }
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(process.argv[2] ?? "dist");
  const changed = await applyToDirectory(directory);
  process.stdout.write(`CSP: hashes completed on ${changed} page(s).\n`);
}
