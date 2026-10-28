import { useTranslation } from "react-i18next";
import { useNoxAuth } from "../auth/useNoxAuth.js";
import { Button } from "../components/Button.js";
import { ShellLayout } from "../layouts/ShellLayout.js";

/** Anything other than an explicit grant. No module names, no request path. */
export function Denied() {
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
      <div className="rounded-2xl border border-somnus-danger/30 bg-somnus-surface p-6 shadow-lg shadow-black/20">
        <h1 className="text-2xl font-semibold text-somnus-text">{t("denied.title")}</h1>
        <p role="alert" className="mt-3 text-somnus-text">
          {t("denied.body")}
        </p>
      </div>
    </ShellLayout>
  );
}
