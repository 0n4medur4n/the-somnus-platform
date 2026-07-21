import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@somnus/api-contracts";
import type { LocaleDictionary } from "./types.js";

export type LocaleBundle = {
  locale: SupportedLocale;
  dictionary: LocaleDictionary;
  source: string;
};

export type LoadOptions = {
  baseDir: string;
  locales?: ReadonlyArray<SupportedLocale>;
};

const JSON_SUFFIX = ".json";
const TS_SUFFIX = ".ts";

export function loadLocaleBundles(options: LoadOptions): ReadonlyArray<LocaleBundle> {
  const locales = options.locales ?? SUPPORTED_LOCALES;
  const base = resolve(options.baseDir);
  const bundles: LocaleBundle[] = [];
  for (const locale of locales) {
    const jsonPath = join(base, `${locale}${JSON_SUFFIX}`);
    const tsPath = join(base, `${locale}${TS_SUFFIX}`);
    let source = jsonPath;
    let dictionary: LocaleDictionary | null = null;
    if (fileExists(jsonPath)) {
      const text = readFileSync(jsonPath, "utf8");
      dictionary = parseFlatDictionary(text, jsonPath);
      source = jsonPath;
    } else if (fileExists(tsPath)) {
      const mod = loadTsModule(tsPath);
      dictionary = readDictionaryFromModule(mod);
      source = tsPath;
    } else {
      throw new Error(
        `i18n: no locale file found for "${locale}" at ${base} (looked for .json and .ts)`,
      );
    }
    if (dictionary === null) {
      throw new Error(`i18n: locale "${locale}" at ${source} did not export a dictionary`);
    }
    bundles.push({ locale, dictionary, source });
  }
  return bundles;
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function parseFlatDictionary(text: string, path: string): LocaleDictionary {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`i18n: ${path} must be a flat object of string keys to string values`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== "string") {
      throw new Error(`i18n: ${path} key "${k}" must be a string, got ${typeof v}`);
    }
    out[k] = v;
  }
  return out;
}

function loadTsModule(path: string): unknown {
  if (path.includes(".ts") && !path.includes("node_modules")) {
    throw new Error(
      `i18n: TypeScript locale modules must be pre-compiled. Use ${path.replace(TS_SUFFIX, JSON_SUFFIX)} for the build, or wire a runtime loader.`,
    );
  }
  const dynamicRequire = createRequire(path);
  return dynamicRequire(path);
}

function readDictionaryFromModule(mod: unknown): LocaleDictionary | null {
  if (typeof mod !== "object" || mod === null) return null;
  const m = mod as { default?: unknown; dictionary?: unknown };
  const candidate = (m.dictionary ?? m.default) as unknown;
  if (typeof candidate !== "object" || candidate === null) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(candidate as Record<string, unknown>)) {
    if (typeof v !== "string") return null;
    out[k] = v;
  }
  return out;
}

export function listLocaleFiles(baseDir: string): string[] {
  const base = resolve(baseDir);
  const out: string[] = [];
  for (const entry of readdirSync(base)) {
    if (entry.endsWith(JSON_SUFFIX) || entry.endsWith(TS_SUFFIX)) {
      out.push(join(base, entry));
    }
  }
  return out;
}
