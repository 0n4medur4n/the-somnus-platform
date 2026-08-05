import { createContext, type ReactNode, useContext, useState } from "react";

export type ActiveOrg = { id: string; name: string };

type OrgContextValue = {
  activeOrg: ActiveOrg | null;
  setActiveOrg: (org: ActiveOrg) => void;
};

const OrgContext = createContext<OrgContextValue | null>(null);

/**
 * The organization the user is currently working with (the one just
 * created or opened). Keeps the members/invitations screens pointed at
 * a concrete org without threading an id through the URL for this
 * foundation checkpoint.
 */
export function OrgProvider({ children }: { children: ReactNode }) {
  const [activeOrg, setActiveOrg] = useState<ActiveOrg | null>(null);
  return <OrgContext.Provider value={{ activeOrg, setActiveOrg }}>{children}</OrgContext.Provider>;
}

export function useActiveOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useActiveOrg must be used within an OrgProvider");
  return ctx;
}
