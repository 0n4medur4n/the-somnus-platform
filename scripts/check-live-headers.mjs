import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Post-deploy check: the headers a visitor really receives from the three
 * public sites, compared with what firebase.json says they must be.
 *
 * Why it exists: `firebase.json` once promised X-Frame-Options and friends for
 * `**\/*.html`, and the deployed sites sent none of them on `/`, `/login` or
 * `/app` for weeks, because Hosting matches a header rule against the request
 * URL and none of those URLs ends in `.html`. Reading the file could not have
 * caught it; only asking the live site can.
 *
 * firebase.json is the single source of truth: the expected headers are the
 * ones its `**` rule sets for the site, so a header added there is checked here
 * without touching this file.
 */

export const SITES = [
  {
    target: "app",
    origin: "https://app.thesomnus.com",
    paths: ["/", "/login", "/app"],
  },
  {
    target: "admin",
    origin: "https://console.thesomnus.com",
    paths: ["/", "/login", "/app"],
  },
  {
    target: "marketing",
    origin: "https://thesomnus.com",
    // /login and /app are 404s on the marketing site; they must carry the headers too.
    paths: ["/", "/es/", "/login", "/app"],
  },
];

const ASSET_PATH = /(?:src|href)="(\/(?:assets|_astro)\/[^"]+\.(?:js|css))"/;

function rulesOf(config, target) {
  const site = config.hosting.find((entry) => entry.target === target);
  if (!site) throw new Error(`firebase.json has no hosting target "${target}"`);
  return site.headers;
}

/** The headers firebase.json sets on every response of `target`: lower-cased name -> value. */
export function expectedHeaders(config, target) {
  const rule = rulesOf(config, target).find((entry) => entry.source === "**");
  if (!rule) throw new Error(`Hosting target "${target}" has no "**" header rule`);
  return new Map(rule.headers.map(({ key, value }) => [key.toLowerCase(), value]));
}

/** The Cache-Control firebase.json gives the hashed assets of `target`. */
export function expectedAssetCache(config, target) {
  const rule = rulesOf(config, target).find((entry) => /\/(?:assets|_astro)\//.test(entry.source));
  const header = rule?.headers.find(({ key }) => key.toLowerCase() === "cache-control");
  if (!header) throw new Error(`Hosting target "${target}" has no asset Cache-Control rule`);
  return header.value;
}

/** Problems found in one response, as readable lines. Empty means it is right. */
export function compareHeaders(actual, expected, label) {
  const problems = [];
  for (const [key, value] of expected) {
    const got = actual.get(key);
    if (got === null || got === undefined) problems.push(`${label}: missing ${key}`);
    else if (got.trim() !== value)
      problems.push(`${label}: ${key} is "${got}", expected "${value}"`);
  }
  return problems;
}

/** A Content-Security-Policy found in an HTML page's <meta>, or null. */
export function metaPolicy(html) {
  const match = /<meta[^>]+http-equiv="content-security-policy"[^>]+content="([^"]*)"/i.exec(html);
  return match ? (match[1] ?? null) : null;
}

export function policyProblems(policy, label) {
  const problems = [];
  for (const unsafe of ["'unsafe-inline'", "'unsafe-eval'"]) {
    if (policy.includes(unsafe)) problems.push(`${label}: policy contains ${unsafe}`);
  }
  return problems;
}

async function get(url, attempts, delayMs) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        headers: { "user-agent": "somnus-post-deploy-header-check" },
      });
      const body = await response.text();
      if (response.status < 500) return { response, body };
      last = new Error(`HTTP ${response.status}`);
    } catch (error) {
      last = error;
    }
    if (attempt < attempts) await new Promise((done) => setTimeout(done, delayMs));
  }
  throw new Error(`${url}: ${last instanceof Error ? last.message : "no answer"}`);
}

async function checkOnce(config, sites) {
  const problems = [];
  for (const site of sites) {
    const expected = expectedHeaders(config, site.target);
    let assetUrl = null;
    for (const path of site.paths) {
      const label = `${site.origin}${path}`;
      const { response, body } = await get(label, 3, 2_000);
      problems.push(...compareHeaders(response.headers, expected, label));
      if (site.target === "marketing" && response.status === 200) {
        const policy = metaPolicy(body);
        if (!policy) problems.push(`${label}: no <meta> Content-Security-Policy in the page`);
        else problems.push(...policyProblems(policy, label));
      }
      if (!assetUrl) {
        const found = ASSET_PATH.exec(body);
        if (found?.[1]) assetUrl = `${site.origin}${found[1]}`;
      }
    }
    if (assetUrl) {
      // Proves rule order: the "**" rule says no-cache, the asset rule must win.
      const { response } = await get(assetUrl, 3, 2_000);
      const cache = response.headers.get("cache-control") ?? "";
      const wanted = expectedAssetCache(config, site.target);
      if (cache.trim() !== wanted) {
        problems.push(`${assetUrl}: cache-control is "${cache}", expected "${wanted}"`);
      }
    } else {
      problems.push(`${site.origin}: found no hashed asset in the page to check caching on`);
    }
  }
  return problems;
}

/**
 * Checks every site; returns the list of problems (empty when all is well).
 * A fresh release takes a moment to reach every CDN edge, so a failing pass is
 * repeated, whole, before it is believed.
 */
export async function checkLiveHeaders(config, options = {}) {
  const { attempts = 6, delayMs = 20_000, sites = SITES } = options;
  let problems = [];
  for (let round = 1; round <= attempts; round += 1) {
    problems = await checkOnce(config, sites);
    if (problems.length === 0) return [];
    if (round < attempts) await new Promise((done) => setTimeout(done, delayMs));
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = JSON.parse(readFileSync(resolve("firebase.json"), "utf8"));
    const problems = await checkLiveHeaders(config, {
      attempts: Number(process.env["LIVE_HEADERS_ATTEMPTS"] ?? 6),
      delayMs: Number(process.env["LIVE_HEADERS_DELAY_MS"] ?? 20_000),
    });
    if (problems.length > 0) {
      process.stderr.write(
        `Live header check FAILED:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`,
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(
        "Live header check passed: all sites send the headers firebase.json sets.\n",
      );
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Live header check failed"}\n`,
    );
    process.exitCode = 1;
  }
}
