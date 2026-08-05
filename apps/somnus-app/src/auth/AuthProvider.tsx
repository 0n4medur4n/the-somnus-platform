import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ApiRequestError } from "../lib/api.js";
import { edge } from "../lib/edge.js";
import { AuthContext, type AuthState } from "./AuthContext.js";
import { firebaseSignOut } from "./firebase-auth.js";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const me = await edge.getMe();
      setState({ status: "authenticated", me });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        setState({ status: "needs-registration" });
      } else {
        setState({ status: "unauthenticated" });
      }
    }
  }, []);

  const logout = useCallback(async () => {
    // Best-effort on both sides; either being already gone is not an error.
    try {
      await edge.logout();
    } catch {
      /* session already cleared */
    }
    try {
      await firebaseSignOut();
    } catch {
      /* firebase already signed out */
    }
    setState({ status: "unauthenticated" });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <AuthContext.Provider value={{ state, refresh, logout }}>{children}</AuthContext.Provider>;
}
