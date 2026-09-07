import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ApiRequestError } from "../lib/api.js";
import { edge } from "../lib/edge.js";
import { AdminAuthContext, type AdminAuthState } from "./AdminAuthContext.js";
import { firebaseSignOut } from "./firebase-auth.js";

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminAuthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const me = await edge.adminMe();
      setState({ status: "authorized", me });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 403) {
        // A real session, refused by the gate: this person is signed in and is
        // not an admin. The denial screen is the whole app for them.
        setState({ status: "denied" });
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

  return (
    <AdminAuthContext.Provider value={{ state, refresh, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}
