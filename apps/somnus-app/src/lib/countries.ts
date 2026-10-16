import { COUNTRY_CODES, type CountryCode, isCountryCode } from "@somnus/api-contracts";
import type { SelectOption } from "../components/SelectField.js";

/**
 * Every country, named in the reader's language and sorted the way that
 * language sorts. The names come from the browser (Intl.DisplayNames): the
 * app keeps codes only, never a translated list of its own.
 */
export function countryOptions(locale: string): SelectOption[] {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  const collator = new Intl.Collator(locale);
  return COUNTRY_CODES.map((code) => ({ value: code, label: names.of(code) ?? code })).sort(
    (a, b) => collator.compare(a.label, b.label),
  );
}

export function countryName(code: string, locale: string): string {
  return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
}

/** A sensible first guess from the browser ("es-ES" -> ES); nothing when it has no region. */
export function browserCountry(): CountryCode | undefined {
  const region = (navigator.languages?.[0] ?? navigator.language ?? "").split("-")[1];
  const code = region?.toUpperCase();
  return isCountryCode(code) ? code : undefined;
}
