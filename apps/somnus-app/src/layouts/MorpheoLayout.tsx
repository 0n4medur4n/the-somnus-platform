import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { accountViewOf } from "../auth/account-view.js";
import { useAuth } from "../auth/useAuth.js";
import { Avatar } from "../components/Avatar.js";
import { Button } from "../components/Button.js";
import { LanguageSwitcher } from "../components/LanguageSwitcher.js";
import { env } from "../config/env.js";

const NAV: ReadonlyArray<{ to: string; key: string; end: boolean }> = [
  { to: "/app", key: "nav.mySpace", end: true },
  { to: "/assessment", key: "nav.newAssessment", end: true },
  { to: "/app/profile", key: "nav.myProfile", end: false },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  isActive
    ? "rounded-md bg-somnus-surface px-3 py-2 font-semibold text-somnus-text"
    : "rounded-md px-3 py-2 text-somnus-subtle hover:bg-somnus-surface/60 hover:text-somnus-text";

/**
 * The shell of a Morpheo user's own space: their questionnaire, their saved
 * assessments, their profile. Nothing from the professional or organization
 * areas -- those are other people's flows.
 */
export function MorpheoLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { state, logout } = useAuth();
  const me = state.status === "authenticated" ? state.me : null;
  const consoleUrl = me && accountViewOf(me).isStaff ? env.VITE_ADMIN_CONSOLE_URL : undefined;

  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        {t("common.skipToContent")}
      </a>
      <header className="border-b border-somnus-muted/20">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 p-4 sm:gap-4">
          <span className="whitespace-nowrap font-semibold text-somnus-text">
            {t("common.appName")}
          </span>
          <div className="flex items-center gap-2 sm:gap-4">
            {me ? <Avatar me={me} className="hidden h-9 w-9 text-sm sm:flex" /> : null}
            <LanguageSwitcher />
            <Button variant="secondary" className="whitespace-nowrap" onClick={() => void logout()}>
              {t("common.signOut")}
            </Button>
          </div>
        </div>
        <nav aria-label={t("common.menu")} className="mx-auto max-w-4xl px-4 pb-3">
          <ul className="flex flex-wrap gap-1">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={linkClass}>
                  {t(item.key)}
                </NavLink>
              </li>
            ))}
            {consoleUrl ? (
              <li>
                <a
                  href={consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass({ isActive: false })}
                >
                  {t("nav.console")}
                  <span className="sr-only"> ({t("common.opensInNewTab")})</span>
                  <span aria-hidden="true">&nbsp;↗</span>
                </a>
              </li>
            ) : null}
          </ul>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-4xl p-4">
        {children}
      </main>
    </div>
  );
}
