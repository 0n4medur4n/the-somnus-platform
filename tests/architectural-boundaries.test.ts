import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architectural guard: no file under `packages/` may import from
 * `services/`. The build plan §7 forbids shared packages from
 * importing service code, repositories, or domain logic.
 *
 * This test scans every .ts file under packages/ and fails the build
 * if it sees an import (or re-export, or dynamic import) whose target
 * resolves to the services/ tree.
 */

const REPO_ROOT = resolve(__dirname, "..");
const PACKAGES_DIR = resolve(REPO_ROOT, "packages");
const SERVICES_DIR_TOKEN = `${resolve(REPO_ROOT, "services").replace(/\\/g, "/")}/`;

type Violation = { file: string; line: number; snippet: string };

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const IMPORT_REGEXES: ReadonlyArray<{ kind: string; re: RegExp }> = [
  { kind: "import", re: /from\s+["']([^"']+)["']/g },
  { kind: "import", re: /import\s*\(["']([^"']+)["']\)/g },
  { kind: "export", re: /export\s+(?:\*|{[^}]*})\s+from\s+["']([^"']+)["']/g },
];

function isRelativeToServices(specifier: string, sourceFile: string): boolean {
  if (specifier.startsWith("services/")) return true;
  if (specifier.startsWith("../../../services/") || specifier.startsWith("../../services/")) {
    return true;
  }
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const absolute = resolve(dirname(sourceFile), specifier).replace(/\\/g, "/");
    return absolute.startsWith(SERVICES_DIR_TOKEN);
  }
  return false;
}

function dirname(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.substring(0, idx);
}

function scan(): Violation[] {
  const violations: Violation[] = [];
  const files = listTsFiles(PACKAGES_DIR);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const { re } of IMPORT_REGEXES) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null = re.exec(line);
        while (m !== null) {
          const spec = m[1];
          if (spec && isRelativeToServices(spec, file)) {
            violations.push({
              file: relative(REPO_ROOT, file).replace(/\\/g, "/"),
              line: i + 1,
              snippet: line.trim(),
            });
          }
          m = re.exec(line);
        }
      }
    }
  }
  return violations;
}

describe("architectural boundary: packages/ must not import from services/", () => {
  it("finds zero cross-boundary imports", () => {
    const violations = scan();
    if (violations.length > 0) {
      const msg = violations.map((v) => `  - ${v.file}:${v.line}  ${v.snippet}`).join("\n");
      throw new Error(`packages/* must not import from services/:\n${msg}`);
    }
    expect(violations.length).toBe(0);
  });
});
