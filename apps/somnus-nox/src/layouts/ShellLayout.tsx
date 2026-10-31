import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../components/LanguageSwitcher.js";
import { ThemeSwitcher } from "../components/ThemeSwitcher.js";

export function ShellLayout({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        {t("common.skipToContent")}
      </a>
      <header className="border-b border-somnus-muted/20">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 p-4">
          <p className="text-lg font-semibold tracking-tight text-somnus-text">
            {t("common.appName")}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-4">
            <ThemeSwitcher />
            <LanguageSwitcher />
            {action}
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto flex max-w-5xl flex-col gap-6 p-4">
        {children}
      </main>
    </div>
  );
}
