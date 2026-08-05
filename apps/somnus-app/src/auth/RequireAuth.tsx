import { useTranslation } from "react-i18next";
import { Navigate, Outlet } from "react-router";
import { FullPageStatus } from "../components/FullPageStatus.js";
import { AppLayout } from "../layouts/AppLayout.js";
import { useAuth } from "./useAuth.js";

/**
 * Route guard. Auth is the edge session, not client state: while it is
 * being determined we show a status region; no session -> /login; a
 * session without a provisioned Somnus user -> finish registration on
 * the callback screen; otherwise render the authenticated shell.
 */
export function RequireAuth() {
  const { state } = useAuth();
  const { t } = useTranslation();

  if (state.status === "loading") return <FullPageStatus message={t("common.loading")} />;
  if (state.status === "unauthenticated") return <Navigate to="/login" replace />;
  if (state.status === "needs-registration") return <Navigate to="/auth/callback" replace />;

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
