import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@somnus/api-contracts";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ca from "./locales/ca.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";

/** es is the reference locale (build plan §3.3: default es, CI fails on a missing key). */
export const resources = {
  es: { translation: es },
  en: { translation: en },
  ca: { translation: ca },
  fr: { translation: fr },
} as const;

/**
 * Initial language: an explicit `?lng=` (used by the E2E run to exercise
 * es and ca), else the browser language when supported, else the default
 * es. A tiny custom detector keeps the dependency surface minimal.
 */
export function detectInitialLanguage(): SupportedLocale {
  if (typeof window !== "undefined") {
    const fromUrl = new URLSearchParams(window.location.search).get("lng");
    if (isSupportedLocale(fromUrl)) return fromUrl;
    const nav = window.navigator.language.slice(0, 2);
    if (isSupportedLocale(nav)) return nav;
  }
  return DEFAULT_LOCALE;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLanguage(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: SUPPORTED_LOCALES,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
