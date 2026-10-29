import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import somnusWordmark from "../assets/brand/somnus-wordmark.png";
import { useAdminAuth } from "../auth/useAdminAuth.js";
import { FullPageStatus } from "../components/FullPageStatus.js";
import { Icon } from "../components/ui/Icon.js";
import { DriveScreen } from "../drive/ui/DriveScreen.js";
import { rememberReturnTo } from "../lib/return-to.js";
import { Denied } from "./Denied.js";
import { Invited } from "./Invited.js";
import { Login } from "./Login.js";

/**
 * The staff Drive in its own tab, filling the window (owner decision
 * 2026-10-19). Same gate as the console -- the server's answer decides -- and
 * the Drive section needs `admin_drive` on top. Its keys live in this tab's
 * memory only: the console tab beside it is unaffected, and closing this one
 * forgets them.
 */
export function DriveApp() {
  const { t } = useTranslation();
  const { state, logout } = useAdminAuth();

  // A Drive link opened while signed out: come back to it after signing in.
  useEffect(() => {
    if (state.status === "unauthenticated") {
      rememberReturnTo(`${window.location.pathname}${window.location.search}`);
    }
  }, [state.status]);

  if (state.status === "loading") return <FullPageStatus message={t("common.loading")} />;
  if (state.status === "unauthenticated") return <Login />;
  if (state.status === "invited") return <Invited invitation={state.invitation} />;
  if (state.status === "denied" || !state.me.capabilities.includes("admin_drive")) {
    return <Denied />;
  }

  return (
    <div className="flex h-screen flex-col bg-somnus-background text-somnus-text">
      <header className="flex items-center gap-3 border-b border-white/[0.06] bg-somnus-surface px-4 py-2.5">
        <img
          src={somnusWordmark}
          width={720}
          height={82}
          alt={t("common.brandName")}
          className="h-4 w-auto"
        />
        <span className="flex items-center gap-1.5 rounded-full border border-white/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-somnus-subtle">
          <Icon name="lock" className="h-3 w-3" />
          {t("drive.title")}
        </span>
        <span className="flex-1" />
        <span className="hidden truncate text-sm text-somnus-subtle sm:inline">
          {state.me.user.email}
        </span>
        <a
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-somnus-text hover:bg-white/5"
        >
          <Icon name="dashboard" className="h-4 w-4" />
          {t("drive.app.toConsole")}
        </a>
        <button
          type="button"
          onClick={() => void logout()}
          aria-label={t("common.signOut")}
          className="rounded-lg p-2 text-somnus-subtle hover:bg-white/10 hover:text-somnus-text"
        >
          <Icon name="logout" className="h-4 w-4" />
        </button>
      </header>
      <main id="main" className="min-h-0 flex-1 overflow-auto">
        <DriveScreen fullScreen />
      </main>
    </div>
  );
}
