import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { completeEmailLinkSignIn, isEmailLink, storedEmail } from "../auth/firebase-auth.js";
import { useAdminAuth } from "../auth/useAdminAuth.js";
import { FullPageStatus } from "../components/FullPageStatus.js";
import { ConsoleLayout } from "../layouts/ConsoleLayout.js";
import { edge } from "../lib/edge.js";

/**
 * Completes the magic link and exchanges it for a session, then hands over to
 * the gate. There is no registration step here: an admin account is an ordinary
 * Somnus account that a `platform_super_admin` has granted an internal role to
 * (Addendum A §A1), and this console never creates one.
 */
export function AuthCallback() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { state, refresh } = useAdminAuth();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (isEmailLink(window.location.href)) {
          const email = storedEmail() ?? window.prompt(t("login.emailLabel")) ?? "";
          const idToken = await completeEmailLinkSignIn(email, window.location.href);
          await edge.createSession(idToken);
        }
        await refresh();
      } catch {
        setFailed(true);
      }
    })();
  }, [refresh, t]);

  useEffect(() => {
    // Both outcomes live at the root: the gate decides which one renders.
    if (state.status === "authorized" || state.status === "denied") {
      navigate("/", { replace: true });
    }
  }, [state.status, navigate]);

  if (failed) {
    return (
      <ConsoleLayout>
        <h1 className="text-2xl font-semibold text-somnus-text">{t("callback.title")}</h1>
        <p role="alert" className="text-somnus-danger">
          {t("callback.error")}
        </p>
      </ConsoleLayout>
    );
  }

  return <FullPageStatus message={t("callback.verifying")} />;
}
