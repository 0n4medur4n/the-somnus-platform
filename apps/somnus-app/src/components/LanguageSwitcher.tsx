import { SUPPORTED_LOCALES } from "@somnus/api-contracts";
import { type ChangeEvent, useId } from "react";
import { useTranslation } from "react-i18next";

const LABELS: Record<string, string> = {
  es: "Español",
  en: "English",
  ca: "Català",
  fr: "Français",
};

/**
 * A labeled <select> to switch locale (build plan §3.3: four locales).
 * Keyboard-operable native control; the label is associated via
 * htmlFor for screen readers.
 */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const id = useId();

  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    void i18n.changeLanguage(event.target.value);
  };

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-somnus-muted">
        {t("common.language")}
      </label>
      <select
        id={id}
        value={i18n.resolvedLanguage}
        onChange={onChange}
        className="rounded-md border border-somnus-muted/40 bg-somnus-surface px-2 py-1 text-sm text-somnus-text"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LABELS[locale] ?? locale}
          </option>
        ))}
      </select>
    </div>
  );
}
