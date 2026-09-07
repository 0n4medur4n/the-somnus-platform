import type { AdminMeResponse } from "@somnus/api-contracts";
import { createContext } from "react";

/**
 * The console's gate, as a state machine (Addendum A Checkpoint 15.1).
 *
 * `denied` is a first-class state, not an error: a signed-in person with no
 * internal role is a normal, expected outcome, and the console must render a
 * denial screen for them rather than a broken app or a retry loop. It is
 * distinct from `unauthenticated`, which means there is no session at all.
 *
 * The server decides. This mirrors the answer; it never derives it.
 */
export type AdminAuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "denied" }
  | { status: "authorized"; me: AdminMeResponse };

export type AdminAuthContextValue = {
  state: AdminAuthState;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

export const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);
