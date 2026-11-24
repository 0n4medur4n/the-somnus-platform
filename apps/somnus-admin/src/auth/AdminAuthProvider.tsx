import { type ReactNode, useCallback, useEffect, useState } from "react";
import { driveHasUnsaved } from "../drive/unsaved.js";
import { ApiRequestError } from "../lib/api.js";
import { edge } from "../lib/edge.js";
import { AdminAuthContext, type AdminAuthState } from "./AdminAuthContext.js";
import { firebaseSignOut } from "./firebase-auth.js";
import {
  confirmSessionBeforeTyping,
  hiddenLongEnough,
  SESSION_RECHECK_TIMEOUT_MS,
  withDeadline,
} from "./session-recheck.js";

/** True (and the state set) when the signed-in address has a staff invitation. */
async function pendingInvitation(setState: (state: AdminAuthState) => void): Promise<boolean> {
  try {
    const { invitation } = await edge.myStaffInvitation();
    if (!invitation) return false;
    setState({ status: "invited", invitation });
    return true;
  } catch {
    // No answer is no invitation: fall back to what the gate said.
    return false;
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminAuthState>({ status: "loading" });
  const [blocking, setBlocking] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await edge.adminMe();
      // Existing staff can also be invited to an additional internal role.
      if (await pendingInvitation(setState)) return;
      setState({ status: "authorized", me });
    } catch (error) {
      // A session the gate refused (403), or one with no account yet (404),
      // may belong to someone the staff invited: ask before deciding.
      if (
        error instanceof ApiRequestError &&
        (error.status === 403 || error.status === 404) &&
        (await pendingInvitation(setState))
      ) {
        return;
      }
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

  // A tab that was hidden for a long idle asks once, before the next keystroke.
  // Unsaved Drive text stays mounted: the sign-in screen would drop it.
  useEffect(() => {
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (!hiddenLongEnough(hiddenAt, Date.now())) return;
      hiddenAt = null;
      const unsaved = driveHasUnsaved();
      if (!unsaved) setBlocking(true);
      void confirmSessionBeforeTyping({
        unsaved,
        me: () => withDeadline(() => edge.adminMe(), SESSION_RECHECK_TIMEOUT_MS),
        onUnauthenticated: () => setState({ status: "unauthenticated" }),
      }).finally(() => setBlocking(false));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return (
    <AdminAuthContext.Provider value={{ state, refresh, logout }}>
      <div className="contents" inert={blocking ? true : undefined}>
        {children}
      </div>
      {blocking ? <div className="fixed inset-0 z-[80]" aria-busy="true" /> : null}
    </AdminAuthContext.Provider>
  );
}
