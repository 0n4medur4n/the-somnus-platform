import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** The console shell: centred, deliberately plain. An internal tool, not a product surface. */
export function ConsoleLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        {t("common.skipToContent")}
      </a>
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between p-4">
        <span className="font-semibold text-somnus-text">{t("common.appName")}</span>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
        {children}
      </main>
    </div>
  );
}
