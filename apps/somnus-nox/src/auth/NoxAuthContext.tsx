import { createContext } from "react";

export type NoxAuthStatus = "loading" | "unauthenticated" | "denied" | "granted";

export type NoxAuthState = { status: NoxAuthStatus };

export type NoxAuthContextValue = {
  state: NoxAuthState;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

export const NoxAuthContext = createContext<NoxAuthContextValue | null>(null);
