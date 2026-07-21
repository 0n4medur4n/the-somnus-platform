import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listLocaleFiles, loadLocaleBundles } from "./loader.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "i18n-test-"));
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function writeJson(locale: string, dict: Record<string, string>): void {
  writeFileSync(join(dir, `${locale}.json`), JSON.stringify(dict));
}

describe("loadLocaleBundles", () => {
  it("loads every supported locale from .json files in the directory", () => {
    writeJson("es", { a: "a-es" });
    writeJson("en", { a: "a-en" });
    writeJson("ca", { a: "a-ca" });
    writeJson("fr", { a: "a-fr" });
    const bundles = loadLocaleBundles({ baseDir: dir });
    expect(bundles.map((b) => b.locale).sort()).toEqual(["ca", "en", "es", "fr"]);
    for (const b of bundles) expect(b.dictionary).toEqual({ a: expect.any(String) });
  });

  it("throws when a locale is missing", () => {
    writeJson("es", { a: "x" });
    expect(() => loadLocaleBundles({ baseDir: dir })).toThrow(/no locale file found for "en"/);
  });

  it("throws when no locale file exists at all for the directory", () => {
    expect(() => loadLocaleBundles({ baseDir: dir, locales: ["es"] })).toThrow(
      /no locale file found/,
    );
  });

  it("rejects a value that is not a string", () => {
    writeJson("es", { a: "ok", b: 1 as unknown as string });
    expect(() => loadLocaleBundles({ baseDir: dir, locales: ["es"] })).toThrow(
      /key "b" must be a string/,
    );
  });

  it("rejects a JSON root that is not a flat object", () => {
    writeFileSync(join(dir, "es.json"), JSON.stringify(["a", "b"]));
    expect(() => loadLocaleBundles({ baseDir: dir, locales: ["es"] })).toThrow(/flat object/);
  });

  it("limits to a subset of locales when the option is provided", () => {
    writeJson("es", { a: "x" });
    writeJson("en", { a: "x" });
    const bundles = loadLocaleBundles({ baseDir: dir, locales: ["es", "en"] });
    expect(bundles.length).toBe(2);
  });

  it("exposes the source path of each bundle", () => {
    writeJson("es", { a: "x" });
    const [es] = loadLocaleBundles({ baseDir: dir, locales: ["es"] });
    expect(es?.source).toMatch(/es\.json$/);
  });
});

describe("listLocaleFiles", () => {
  it("returns json and ts files in the base directory", () => {
    writeFileSync(join(dir, "es.json"), "{}");
    writeFileSync(join(dir, "en.json"), "{}");
    writeFileSync(join(dir, "README.md"), "# ignore me");
    const files = listLocaleFiles(dir);
    expect(files.length).toBe(2);
    expect(files.every((f) => f.endsWith(".json"))).toBe(true);
  });
});
