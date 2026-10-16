import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import somnusWordmark from "../assets/brand/somnus-wordmark.png";

/** The console shell: centred, deliberately plain. An internal tool, not a product surface. */
export function ConsoleLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        {t("common.skipToContent")}
      </a>
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between p-4">
        <span className="flex items-center gap-3">
          {/* The wordmark is the name: its alt text is the brand. */}
          <img
            src={somnusWordmark}
            width={720}
            height={82}
            alt={t("common.brandName")}
            className="h-6 w-auto"
          />
          <span className="rounded-full border border-somnus-subtle/25 px-2.5 py-0.5 text-xs font-medium text-somnus-subtle">
            {t("common.consoleLabel")}
          </span>
        </span>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
        {children}
      </main>
    </div>
  );
}
