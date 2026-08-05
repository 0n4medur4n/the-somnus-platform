import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { useAuth } from "../auth/useAuth.js";
import { Button } from "../components/Button.js";
import { LanguageSwitcher } from "../components/LanguageSwitcher.js";

const NAV: ReadonlyArray<{ to: string; key: string; end: boolean }> = [
  { to: "/app", key: "nav.home", end: true },
  { to: "/app/profile", key: "nav.profile", end: false },
  { to: "/app/security", key: "nav.security", end: false },
  { to: "/professional", key: "nav.professional", end: true },
  { to: "/professional/profile", key: "nav.profile", end: false },
  { to: "/organization", key: "nav.organization", end: true },
  { to: "/organization/members", key: "nav.members", end: false },
  { to: "/organization/invitations", key: "nav.invitations", end: false },
];

/** Authenticated shell: skip link, header, primary nav landmark, main landmark. */
export function AppLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { logout } = useAuth();

  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        {t("common.skipToContent")}
      </a>
      <header className="border-b border-somnus-muted/20">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 p-4">
          <span className="font-semibold text-somnus-text">{t("common.appName")}</span>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <Button variant="secondary" onClick={() => void logout()}>
              {t("common.signOut")}
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:flex-row">
        <nav aria-label={t("common.menu")} className="sm:w-56">
          <ul className="flex flex-col gap-1">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    isActive
                      ? "font-semibold text-somnus-primary"
                      : "text-somnus-text hover:text-somnus-primary"
                  }
                >
                  {t(item.key)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" tabIndex={-1} className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
