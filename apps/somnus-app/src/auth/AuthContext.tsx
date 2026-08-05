import type { MeResponse } from "@somnus/api-contracts";
import { createContext } from "react";

/**
 * Auth is derived from edge-api's session, never from Firebase client
 * state: `/v1/me` returns the composed user (200 = signed in), 401 =
 * no session, 404 = session established but the Somnus user is not
 * provisioned yet (registration must complete).
 */
export type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "needs-registration" }
  | { status: "authenticated"; me: MeResponse };

export type AuthContextValue = {
  state: AuthState;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
