import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "../components/BrandLogo.js";
import { LanguageSwitcher } from "../components/LanguageSwitcher.js";
import { ThemeSwitcher } from "../components/ThemeSwitcher.js";

/** Centered layout for the unauthenticated screens (login, callback). */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        {t("common.skipToContent")}
      </a>
      <header className="mx-auto flex w-full max-w-md flex-col items-center gap-6 p-4 pt-6">
        <div className="flex w-full flex-wrap items-center justify-end gap-3">
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
        <BrandLogo brand="somnus" className="h-auto w-60 max-w-full sm:w-72" />
      </header>
      <main id="main" tabIndex={-1} className="mx-auto flex max-w-md flex-col gap-4 p-4">
        {children}
      </main>
    </div>
  );
}
