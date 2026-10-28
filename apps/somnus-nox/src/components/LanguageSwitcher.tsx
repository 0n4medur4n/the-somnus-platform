import { SUPPORTED_LOCALES } from "@somnus/api-contracts";
import { type ChangeEvent, useId } from "react";
import { useTranslation } from "react-i18next";

export const LOCALE_LABELS: Record<string, string> = {
  es: "Español",
  en: "English",
  ca: "Català",
  fr: "Français",
};

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const id = useId();

  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    void i18n.changeLanguage(event.target.value);
  };

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="hidden text-sm text-somnus-subtle sm:inline">
        {t("common.language")}
      </label>
      <select
        id={id}
        aria-label={t("common.language")}
        value={i18n.resolvedLanguage}
        onChange={onChange}
        className="rounded-md border border-somnus-muted/40 bg-somnus-surface px-2 py-1 text-sm text-somnus-text"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_LABELS[locale] ?? locale}
          </option>
        ))}
      </select>
    </div>
  );
}
