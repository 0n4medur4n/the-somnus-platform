import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Build plan §5.3 / §20 Checkpoint 8.2: edge-api is a BFF and MUST NOT
 * hold a TiDB/MySQL connection. It reaches data only by calling private
 * services over HTTP (the cloud-run client). This test fails the build
 * if a database driver or ORM is ever added, in dependencies or in
 * source imports -- the architectural guardrail the checkpoint requires.
 */

const FORBIDDEN_PACKAGES = [
  "mysql2",
  "mysql",
  "drizzle-orm",
  "drizzle-kit",
  "pg",
  "postgres",
  "@planetscale/database",
  "tidb",
];

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("edge-api has no TiDB/database connection (build plan §5.3)", () => {
  it("declares no database driver or ORM as a dependency", () => {
    const pkg = readJson("../../package.json");
    const deps = {
      ...(pkg["dependencies"] as Record<string, string> | undefined),
      ...(pkg["devDependencies"] as Record<string, string> | undefined),
    };
    for (const forbidden of FORBIDDEN_PACKAGES) {
      expect(Object.keys(deps), `edge-api must not depend on ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("imports no database driver or ORM anywhere in src", () => {
    const files = walk(`${packageRoot}src`);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const forbidden of FORBIDDEN_PACKAGES) {
        const importRe = new RegExp(`from ["']${forbidden}(["'/]|$)`, "m");
        if (importRe.test(content)) offenders.push(`${file} -> ${forbidden}`);
      }
    }
    expect(offenders, "no src file may import a database driver/ORM").toEqual([]);
  });

  it("reads no DATABASE_URL from configuration", () => {
    const config = readFileSync(`${packageRoot}src/config/edge-config.ts`, "utf8");
    expect(config).not.toMatch(/DATABASE_URL/);
  });
});
