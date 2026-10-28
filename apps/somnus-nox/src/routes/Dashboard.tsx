import { useTranslation } from "react-i18next";
import { useNoxAuth } from "../auth/useNoxAuth.js";
import { Button } from "../components/Button.js";
import { ShellLayout } from "../layouts/ShellLayout.js";
import { NOX_MODULES } from "../modules/registry.js";

export function Dashboard() {
  const { t } = useTranslation();
  const { logout } = useNoxAuth();

  return (
    <ShellLayout
      action={
        <Button variant="secondary" onClick={() => void logout()}>
          {t("common.signOut")}
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-somnus-text">{t("dashboard.title")}</h1>
        <p className="text-somnus-subtle">{t("dashboard.intro")}</p>
      </div>
      <ul data-testid="nox-module-list" className="grid gap-4 sm:grid-cols-2">
        {NOX_MODULES.map((module) => (
          <li key={module.id}>
            <article className="rounded-2xl border border-somnus-subtle/15 bg-somnus-surface p-6 shadow-lg shadow-black/20">
              <h2 className="text-lg font-semibold text-somnus-text">{t(module.titleKey)}</h2>
              <p className="mt-2 text-sm text-somnus-subtle">{t(module.statusKey)}</p>
            </article>
          </li>
        ))}
      </ul>
    </ShellLayout>
  );
}
