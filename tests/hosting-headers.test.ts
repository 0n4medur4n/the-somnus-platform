import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guards firebase.json's security headers.
 *
 * The first version of these rules matched `**\/*.html`. Hosting matches a rule
 * against the request URL, and `/`, `/login` and `/app` do not end in `.html`,
 * so the deployed sites sent none of them. These tests pin the shape that works:
 * one `**` rule per site carrying every header, and nothing that weakens the CSP.
 */

type Header = { key: string; value: string };
type Rule = { source: string; headers: Header[] };
type Site = {
  target: string;
  rewrites?: Array<{ source: string; destination?: string }>;
  headers: Rule[];
};

const config = JSON.parse(readFileSync("firebase.json", "utf8")) as { hosting: Site[] };

const REQUIRED = [
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "strict-transport-security",
  "cache-control",
];

/**
 * Sites whose header CSP deliberately has no script-src / style-src, with the
 * reason. Growing this list needs the owner's decision.
 *
 * - admin: the Drive viewers run files inside `srcdoc` frames that inherit the
 *   page's policy and need inline script and eval (see docs/security/hosting-headers.md).
 * - marketing: Astro generates a per-page <meta> policy with the script and
 *   style hashes (apps/somnus-marketing tests assert it); a header policy with
 *   its own script-src would intersect with it and block the hashed scripts.
 */
const NO_SCRIPT_STYLE_IN_HEADER = ["admin", "marketing"];

function site(target: string): Site {
  const found = config.hosting.find((entry) => entry.target === target);
  if (!found) throw new Error(`no hosting target ${target}`);
  return found;
}

function everyResponse(target: string): Map<string, string> {
  const rule = site(target).headers.find((entry) => entry.source === "**");
  if (!rule) throw new Error(`${target}: no "**" header rule`);
  return new Map(rule.headers.map(({ key, value }) => [key.toLowerCase(), value]));
}

function directives(policy: string): Map<string, string> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name = "", ...sources] = part.split(/\s+/);
        return [name, sources.join(" ")] as const;
      }),
  );
}

const targets = config.hosting.map((entry) => entry.target);

describe("firebase.json security headers", () => {
  it("covers exactly the three public sites", () => {
    expect(targets.sort()).toEqual(["admin", "app", "marketing"]);
  });

  describe.each(["app", "admin", "marketing"])("%s", (target) => {
    it("sets every required header on every response (the ** rule)", () => {
      const headers = everyResponse(target);
      for (const key of REQUIRED) expect(headers.has(key), `${target} lost ${key}`).toBe(true);
    });

    it("no other rule overrides a security header", () => {
      const protectedKeys = REQUIRED.filter((key) => key !== "cache-control");
      for (const rule of site(target).headers.filter((entry) => entry.source !== "**")) {
        for (const { key, value } of rule.headers) {
          const lower = key.toLowerCase();
          if (!protectedKeys.includes(lower)) continue;
          expect(value, `${rule.source} changes ${key}`).toBe(everyResponse(target).get(lower));
        }
      }
    });

    it("sends nosniff, a frame deny, and the strict referrer policy", () => {
      const headers = everyResponse(target);
      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("x-frame-options")).toBe("DENY");
      expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(headers.get("strict-transport-security")).toMatch(/^max-age=31536000/);
    });

    it("never lets HTML sit in a cache for an hour", () => {
      expect(everyResponse(target).get("cache-control")).toBe("no-cache");
    });

    it("has a CSP that denies framing, plugins and base-tag tricks", () => {
      const csp = directives(everyResponse(target).get("content-security-policy") ?? "");
      expect(csp.get("frame-ancestors")).toBe("'none'");
      expect(csp.get("object-src")).toBe("'none'");
      expect(csp.get("base-uri")).toBe("'self'");
      expect(csp.get("form-action")).toBe("'self'");
    });

    it("has a CSP without unsafe-inline, unsafe-eval, wildcards or plain http", () => {
      const policy = everyResponse(target).get("content-security-policy") ?? "";
      expect(policy).not.toContain("unsafe-inline");
      expect(policy).not.toContain("unsafe-eval");
      expect(policy).not.toMatch(/(^|[\s;])\*(\s|;|$)/);
      expect(policy).not.toMatch(/\bhttp:/);
      expect(policy).not.toContain("script-src-attr");
    });

    it("keeps a script-src and style-src in the header unless the exception list says otherwise", () => {
      const csp = directives(everyResponse(target).get("content-security-policy") ?? "");
      if (NO_SCRIPT_STYLE_IN_HEADER.includes(target)) {
        expect(csp.has("script-src")).toBe(false);
        expect(csp.has("style-src")).toBe(false);
      } else {
        expect(csp.get("default-src")).toBe("'none'");
        expect(csp.get("script-src")).toMatch(/^'self'/);
        expect(csp.get("style-src")).toBe("'self'");
      }
    });

    it("keeps the exception list as it was decided", () => {
      expect(NO_SCRIPT_STYLE_IN_HEADER).toEqual(["admin", "marketing"]);
    });
  });

  it("allows the microphone to the two apps that dictate, and to nobody else", () => {
    expect(everyResponse("app").get("permissions-policy")).toContain("microphone=(self)");
    expect(everyResponse("admin").get("permissions-policy")).toContain("microphone=(self)");
    expect(everyResponse("marketing").get("permissions-policy")).toContain("microphone=()");
    for (const target of targets) {
      expect(everyResponse(target).get("permissions-policy")).toContain("camera=()");
      expect(everyResponse(target).get("permissions-policy")).toContain("geolocation=()");
    }
  });

  it("limits the app's network to its own origin, Firebase Auth and the dictation socket", () => {
    const csp = directives(everyResponse("app").get("content-security-policy") ?? "");
    expect(csp.get("connect-src")?.split(" ").sort()).toEqual(
      [
        "'self'",
        "https://identitytoolkit.googleapis.com",
        "https://securetoken.googleapis.com",
        "wss://streaming.eu.assemblyai.com",
      ].sort(),
    );
    expect(csp.get("script-src")?.split(" ").sort()).toEqual(["'self'", "blob:"]);
  });

  it("keeps hashed assets immutable, after the ** rule so they win", () => {
    for (const target of targets) {
      const rules = site(target).headers;
      const everything = rules.findIndex((entry) => entry.source === "**");
      const assets = rules.findIndex((entry) => /(assets|_astro)/.test(entry.source));
      expect(assets, `${target}: no asset rule`).toBeGreaterThan(everything);
      expect(rules[assets]?.headers).toContainEqual({
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable",
      });
    }
  });

  it("serves a future sw.js and manifest from the file, uncached, never from index.html", () => {
    const app = site("app");
    const rewrites = app.rewrites ?? [];
    const catchAll = rewrites.findIndex((entry) => entry.source === "**");
    for (const file of ["/sw.js", "/manifest.webmanifest"]) {
      const own = rewrites.findIndex((entry) => entry.source === file);
      expect(own, `${file} needs its own rewrite`).toBeGreaterThanOrEqual(0);
      expect(own).toBeLessThan(catchAll);
      expect(rewrites[own]?.destination).toBe(file);
    }
    const rule = app.headers.find((entry) => entry.source.includes("sw.js"));
    expect(rule?.headers).toContainEqual({ key: "Cache-Control", value: "no-cache" });
  });

  it("no longer relies on a **/*.html header rule", () => {
    for (const entry of config.hosting) {
      expect(entry.headers.map((rule) => rule.source)).not.toContain("**/*.html");
    }
  });
});
