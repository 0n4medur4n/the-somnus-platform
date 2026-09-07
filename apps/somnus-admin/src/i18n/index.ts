import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";

/**
 * The console is an internal tool, so it ships in **es and en only** -- the
 * decision recorded for Addendum A §A5.5. That is deliberately narrower than
 * the platform's four consumer locales (build plan §3.3): ca and fr exist for
 * the people Somnus serves, not for the handful of staff who operate it.
 *
 * es stays the reference locale, and the completeness test still fails CI on a
 * missing key -- the rule is unchanged, only the locale set is.
 */
export const ADMIN_LOCALES = ["es", "en"] as const;
export type AdminLocale = (typeof ADMIN_LOCALES)[number];

export const DEFAULT_ADMIN_LOCALE: AdminLocale = "es";

export function isAdminLocale(value: unknown): value is AdminLocale {
  return typeof value === "string" && (ADMIN_LOCALES as ReadonlyArray<string>).includes(value);
}

export const resources = {
  es: { translation: es },
  en: { translation: en },
} as const;

/** An explicit `?lng=`, else the browser language when supported, else es. */
export function detectInitialLanguage(): AdminLocale {
  if (typeof window !== "undefined") {
    const fromUrl = new URLSearchParams(window.location.search).get("lng");
    if (isAdminLocale(fromUrl)) return fromUrl;
    const nav = window.navigator.language.slice(0, 2);
    if (isAdminLocale(nav)) return nav;
  }
  return DEFAULT_ADMIN_LOCALE;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLanguage(),
  fallbackLng: DEFAULT_ADMIN_LOCALE,
  supportedLngs: [...ADMIN_LOCALES],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
