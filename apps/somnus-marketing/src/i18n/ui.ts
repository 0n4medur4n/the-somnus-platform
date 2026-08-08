import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@somnus/api-contracts";
import ca from "./ca.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";

/**
 * Marketing i18n — build plan §3.3 / ADR 0012.
 *
 * Locale dictionaries are flat `string -> string` maps (dotted keys) loaded
 * at build time by Astro/Vite. The shared completeness check
 * (`@somnus/i18n`) asserts that all four locales contain exactly the same
 * keys, so a missing key in any locale fails CI.
 */
export type Locale = "es" | "en" | "ca" | "fr";

export const LOCALES: ReadonlyArray<Locale> = SUPPORTED_LOCALES as ReadonlyArray<Locale>;
export const DEFAULT: Locale = DEFAULT_LOCALE as Locale;

export type Dictionary = Readonly<Record<string, string>>;

const empty: Dictionary = Object.freeze({});
const dictionaries: Readonly<Record<Locale, Dictionary>> = Object.freeze({
  es,
  en,
  ca,
  fr,
});

const STORAGE_KEY = "somnus:locale";

/**
 * Native names shown in the language switcher. They are constant across
 * locales on purpose: a French visitor looking for "Català" should see the
 * Catalan endonym, not a French translation of it.
 */
export const LOCALE_NATIVE_NAMES: Readonly<Record<Locale, string>> = Object.freeze({
  es: "Español",
  en: "English",
  ca: "Català",
  fr: "Français",
});

/**
 * BCP-47 hreflang values. They map 1:1 to the supported locales because we
 * do not regionalize further (no es-AR vs es-ES split).
 */
export const LOCALE_HREFLANG: Readonly<Record<Locale, string>> = Object.freeze({
  es: "es",
  en: "en",
  ca: "ca",
  fr: "fr",
});

export function isLocale(value: string | undefined): value is Locale {
  return value === "es" || value === "en" || value === "ca" || value === "fr";
}

/**
 * Look up a key in a locale, falling back to the default `es` dictionary
 * and finally to the key itself (so a missing key is loud in dev but never
 * crashes a static page). Interpolates `{name}` placeholders.
 */
export function t(
  locale: Locale | undefined,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const loc: Locale = isLocale(locale) ? locale : DEFAULT;
  const dict = dictionaries[loc] ?? dictionaries[DEFAULT] ?? empty;
  const ref = dictionaries[DEFAULT] ?? empty;
  const raw = dict[key] ?? ref[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * Build a path-prefixed URL for a locale, preserving the rest of the path
 * and query string. Examples:
 *   localizedPath("fr", "/pricing") -> "/fr/pricing"
 *   localizedPath("es", "/")        -> "/es/"
 */
export function localizedPath(locale: Locale, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const trimmed = clean.replace(/^\/[a-z]{2}(?=\/|$)/, "");
  const rest = trimmed === "/" ? "/" : trimmed.replace(/\/$/, "");
  return `/${locale}${rest === "/" ? "/" : `${rest}/`}`;
}

/**
 * Resolve a locale from a raw path segment. Returns the default locale
 * when the segment is absent or unknown.
 */
export function localeFromPath(pathname: string): Locale {
  const match = /^\/([a-z]{2})(?=\/|$)/.exec(pathname);
  const candidate = match?.[1];
  return isLocale(candidate) ? candidate : DEFAULT;
}

export const LOCALE_STORAGE_KEY = STORAGE_KEY;
