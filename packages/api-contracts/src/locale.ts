import { z } from "zod";

export const SUPPORTED_LOCALES = ["es", "en", "ca", "fr"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "es";

export const LocaleSchema = z.enum(SUPPORTED_LOCALES);

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as ReadonlyArray<string>).includes(value);
}
