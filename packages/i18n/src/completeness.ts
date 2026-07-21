import { SUPPORTED_LOCALES, type SupportedLocale } from "@somnus/api-contracts";
import type { LocaleBundle } from "./loader.js";

export type CompletenessResult = {
  ok: boolean;
  missing: Readonly<Record<SupportedLocale, ReadonlyArray<string>>>;
  extra: Readonly<Record<SupportedLocale, ReadonlyArray<string>>>;
  reference: SupportedLocale;
};

export type CompletenessOptions = {
  reference?: SupportedLocale;
};

export function checkCompleteness(
  bundles: ReadonlyArray<LocaleBundle>,
  options: CompletenessOptions = {},
): CompletenessResult {
  const reference = options.reference ?? "es";
  const byLocale = new Map<SupportedLocale, LocaleBundle>();
  for (const b of bundles) byLocale.set(b.locale, b);

  const refBundle = byLocale.get(reference);
  if (!refBundle) {
    throw new Error(
      `i18n completeness: reference locale "${reference}" is missing from the provided bundles. ` +
        `Expected one of: ${SUPPORTED_LOCALES.join(", ")}.`,
    );
  }
  const refKeys = new Set(Object.keys(refBundle.dictionary));

  const missing: Record<SupportedLocale, string[]> = {
    es: [],
    en: [],
    ca: [],
    fr: [],
  };
  const extra: Record<SupportedLocale, string[]> = {
    es: [],
    en: [],
    ca: [],
    fr: [],
  };

  let ok = true;
  for (const locale of SUPPORTED_LOCALES) {
    const bundle = byLocale.get(locale);
    if (!bundle) {
      ok = false;
      missing[locale].push(...refKeys);
      continue;
    }
    const keys = new Set(Object.keys(bundle.dictionary));
    for (const k of refKeys) if (!keys.has(k)) missing[locale].push(k);
    for (const k of keys) if (!refKeys.has(k)) extra[locale].push(k);
    if (missing[locale].length > 0 || extra[locale].length > 0) ok = false;
  }

  for (const loc of Object.keys(missing) as SupportedLocale[]) {
    missing[loc].sort();
    extra[loc].sort();
  }

  return { ok, missing, extra, reference };
}

export function formatCompletenessReport(result: CompletenessResult): string {
  if (result.ok) return "i18n completeness: OK (all 4 locales match the reference).";
  const lines: string[] = ["i18n completeness: FAIL"];
  for (const loc of SUPPORTED_LOCALES) {
    const m = result.missing[loc];
    const e = result.extra[loc];
    if (m.length === 0 && e.length === 0) continue;
    if (m.length > 0) lines.push(`  - ${loc}: missing ${m.length} key(s): ${m.join(", ")}`);
    if (e.length > 0) lines.push(`  - ${loc}: extra   ${e.length} key(s): ${e.join(", ")}`);
  }
  return lines.join("\n");
}
