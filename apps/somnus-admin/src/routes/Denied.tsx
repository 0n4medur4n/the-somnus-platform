import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../auth/useAdminAuth.js";
import { Button } from "../components/Button.js";
import { ConsoleLayout } from "../layouts/ConsoleLayout.js";

/**
 * Addendum A Checkpoint 15.1: "if the session carries no internal role, the app
 * shows nothing but a denial screen."
 *
 * Nothing but. No navigation, no capability list, no hint of what the console
 * contains, and no way to request access -- internal roles are assigned by a
 * `platform_super_admin` and are never self-service (§A1). The only action is
 * to sign out.
 */
export function Denied() {
  const { t } = useTranslation();
  const { logout } = useAdminAuth();

  return (
    <ConsoleLayout>
      <div className="rounded-2xl border border-somnus-danger/30 bg-somnus-surface p-6 shadow-lg shadow-black/20">
        <h1 className="text-2xl font-semibold text-somnus-text">{t("denied.title")}</h1>
        <p role="alert" className="mt-3 text-somnus-text">
          {t("denied.body")}
        </p>
        <p className="mt-3 text-sm text-somnus-subtle">{t("denied.noSelfService")}</p>
        <div className="mt-6">
          <Button variant="secondary" onClick={() => void logout()}>
            {t("common.signOut")}
          </Button>
        </div>
      </div>
    </ConsoleLayout>
  );
}
