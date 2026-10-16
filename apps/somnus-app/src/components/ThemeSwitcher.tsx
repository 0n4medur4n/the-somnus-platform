import { type ChangeEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { saveTheme, storedTheme, THEMES, type Theme } from "../theme.js";

/**
 * Dark, light (dark text on a light background) or high contrast. A native
 * labeled <select>, like the language switcher next to it.
 */
export function ThemeSwitcher() {
  const { t } = useTranslation();
  const id = useId();
  const [theme, setTheme] = useState<Theme>(storedTheme);

  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = event.target.value as Theme;
    setTheme(next);
    saveTheme(next);
  };

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="hidden text-sm text-somnus-subtle sm:inline">
        {t("common.theme")}
      </label>
      <select
        id={id}
        aria-label={t("common.theme")}
        value={theme}
        onChange={onChange}
        className="rounded-md border border-somnus-muted/40 bg-somnus-surface px-2 py-1 text-sm text-somnus-text"
      >
        {THEMES.map((option) => (
          <option key={option} value={option}>
            {t(`common.themes.${option}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
