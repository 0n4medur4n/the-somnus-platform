import { createContext, type ReactNode, useCallback, useContext, useState } from "react";

export type ActiveOrg = { id: string; name: string };

type OrgContextValue = {
  activeOrg: ActiveOrg | null;
  setActiveOrg: (org: ActiveOrg) => void;
};

const OrgContext = createContext<OrgContextValue | null>(null);

/** sessionStorage (an org id + name, never a token) so the active org survives a page reload. */
const STORAGE_KEY = "somnus_active_org";

function load(): ActiveOrg | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ActiveOrg) : null;
  } catch {
    return null;
  }
}

/**
 * The organization the user is currently working with (the one just
 * created or opened). Persisted in sessionStorage so the members and
 * invitations screens keep pointing at it across a reload, without
 * threading an id through the URL for this foundation checkpoint.
 */
export function OrgProvider({ children }: { children: ReactNode }) {
  const [activeOrg, setActiveOrgState] = useState<ActiveOrg | null>(load);

  const setActiveOrg = useCallback((org: ActiveOrg) => {
    setActiveOrgState(org);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(org));
    } catch {
      /* storage unavailable -- fall back to in-memory only */
    }
  }, []);

  return <OrgContext.Provider value={{ activeOrg, setActiveOrg }}>{children}</OrgContext.Provider>;
}

export function useActiveOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useActiveOrg must be used within an OrgProvider");
  return ctx;
}
