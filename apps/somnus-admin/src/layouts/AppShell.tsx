import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import somnusWordmark from "../assets/brand/somnus-wordmark.png";
import { Icon, type IconName } from "../components/ui/Icon.js";

export type NavItem<Id extends string> = {
  id: Id;
  label: string;
  icon: IconName;
  /** Pending work in that section; shown only when above zero. */
  count?: number;
};

export type NavGroup<Id extends string> = { label: string; items: NavItem<Id>[] };

/**
 * The signed-in console: a fixed sidebar (a drawer on small screens), a top bar
 * naming where you are, and a wide content area. It renders only the items it
 * is handed -- which sections exist is decided by identity's capabilities, in
 * ConsoleHome, never here.
 */
export function AppShell<Id extends string>({
  groups,
  active,
  onNavigate,
  email,
  roles,
  onSignOut,
  title,
  section,
  titleIsHeading = true,
  children,
}: {
  groups: NavGroup<Id>[];
  active: Id;
  onNavigate: (id: Id) => void;
  email: string;
  roles: string[];
  onSignOut: () => void;
  /** The page's name. */
  title: string;
  /**
   * Whether the top bar's name is the page's h1. False for screens that carry
   * their own heading, so a page never announces its title twice.
   */
  titleIsHeading?: boolean;
  /** The group the page belongs to, shown above the title. */
  section?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (!drawer) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [drawer]);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-4 pt-5">
        <img
          src={somnusWordmark}
          width={720}
          height={82}
          alt={t("common.brandName")}
          className="h-5 w-auto"
        />
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-somnus-subtle">
          {t("common.consoleLabel")}
        </span>
      </div>
      <nav aria-label={t("console.title")} className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.label} className="mt-4 first:mt-1">
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-somnus-muted">
              {group.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const current = item.id === active;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={current ? "page" : undefined}
                      onClick={() => {
                        onNavigate(item.id);
                        setDrawer(false);
                      }}
                      className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                        current
                          ? "bg-somnus-primary/15 text-somnus-text"
                          : "text-somnus-subtle hover:bg-white/[0.04] hover:text-somnus-text"
                      }`}
                    >
                      <Icon
                        name={item.icon}
                        className={`h-[18px] w-[18px] shrink-0 ${current ? "text-somnus-primary" : ""}`}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.count ? (
                        <>
                          <span
                            aria-hidden="true"
                            className="rounded-full bg-somnus-primary px-1.5 text-[11px] font-semibold tabular-nums text-white"
                          >
                            {item.count}
                          </span>
                          <span className="sr-only">
                            {t("console.pendingCount", { count: item.count })}
                          </span>
                        </>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/[0.06] p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-somnus-primary/20 text-sm font-semibold uppercase text-somnus-primary">
            {email.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-somnus-text">{email}</p>
            <p className="truncate text-xs text-somnus-subtle">{roles.join(" · ")}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-somnus-text hover:bg-white/5"
        >
          <Icon name="logout" className="h-4 w-4" />
          {t("common.signOut")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-somnus-background">
      <a href="#main" className="skip-link">
        {t("common.skipToContent")}
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-white/[0.06] bg-[#0b1122] lg:block">
        {sidebar}
      </aside>
      {drawer ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={t("ui.close")}
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawer(false)}
          />
          <aside className="relative h-full w-72 max-w-[85vw] border-r border-white/[0.06] bg-[#0b1122]">
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/[0.06] bg-somnus-background/85 px-4 py-3 backdrop-blur sm:px-8">
          <button
            type="button"
            aria-label={t("console.openMenu")}
            onClick={() => setDrawer(true)}
            className="rounded-lg p-2 text-somnus-subtle hover:bg-white/5 lg:hidden"
          >
            <Icon name="menu" />
          </button>
          <div className="min-w-0">
            {titleIsHeading ? (
              <>
                {section ? <p className="truncate text-xs text-somnus-subtle">{section}</p> : null}
                <h1 className="truncate text-lg font-semibold text-somnus-text">{title}</h1>
              </>
            ) : (
              <p className="flex items-center gap-1.5 truncate text-sm">
                {section ? (
                  <>
                    <span className="text-somnus-subtle">{section}</span>
                    <Icon name="chevronRight" className="h-4 w-4 text-somnus-muted" />
                  </>
                ) : null}
                <span className="font-medium text-somnus-text">{title}</span>
              </p>
            )}
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
