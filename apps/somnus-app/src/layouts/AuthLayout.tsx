import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../components/LanguageSwitcher.js";

/** Centered layout for the unauthenticated screens (login, callback). */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        {t("common.skipToContent")}
      </a>
      <header className="mx-auto flex w-full max-w-md items-center justify-between p-4">
        <span className="font-semibold text-somnus-text">{t("common.appName")}</span>
        <LanguageSwitcher />
      </header>
      <main id="main" tabIndex={-1} className="mx-auto flex max-w-md flex-col gap-4 p-4">
        {children}
      </main>
    </div>
  );
}
