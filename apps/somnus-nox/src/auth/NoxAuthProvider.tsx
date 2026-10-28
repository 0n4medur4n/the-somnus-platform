import { onAuthStateChanged } from "firebase/auth";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { grantFromBody, loadNoxMe, type NoxMeReader } from "../api/load-nox-me.js";
import { devPreview, fetchNoxMe } from "../api/nox-me.js";
import { getFirebaseAuth } from "../lib/firebase.js";
import { firebaseSignOut } from "./firebase-auth.js";
import { NoxAuthContext, type NoxAuthState } from "./NoxAuthContext.js";

export type NoxSessionOverride = "signed-in" | "signed-out";

type NoxAuthProviderProps = {
  children: ReactNode;
  reader?: NoxMeReader;
  session?: NoxSessionOverride;
  timeoutMs?: number;
};

export function NoxAuthProvider({
  children,
  reader = fetchNoxMe,
  session,
  timeoutMs,
}: NoxAuthProviderProps) {
  const [state, setState] = useState<NoxAuthState>({ status: "loading" });

  const applyBody = useCallback(
    async (read: NoxMeReader) => {
      try {
        const body =
          timeoutMs === undefined ? await loadNoxMe(read) : await loadNoxMe(read, timeoutMs);
        setState({ status: grantFromBody(body) ? "granted" : "denied" });
      } catch {
        setState({ status: "denied" });
      }
    },
    [timeoutMs],
  );

  const refresh = useCallback(async () => {
    const preview = session === undefined ? devPreview() : null;
    if (preview === "dashboard") {
      setState({ status: "granted" });
      return;
    }
    if (preview === "denied" || session === "signed-out") {
      setState({ status: preview === "denied" ? "denied" : "unauthenticated" });
      return;
    }
    if (session === "signed-in") {
      await applyBody(reader);
      return;
    }
    const auth = getFirebaseAuth();
    if (!auth.currentUser) {
      setState({ status: "unauthenticated" });
      return;
    }
    await applyBody(reader);
  }, [applyBody, reader, session]);

  const logout = useCallback(async () => {
    try {
      await firebaseSignOut();
    } catch {
      /* already signed out */
    }
    setState({ status: "unauthenticated" });
  }, []);

  useEffect(() => {
    if (session === "signed-out") {
      setState({ status: "unauthenticated" });
      return;
    }
    if (session === "signed-in") {
      void applyBody(reader);
      return;
    }
    const preview = devPreview();
    if (preview === "dashboard") {
      setState({ status: "granted" });
      return;
    }
    if (preview === "denied") {
      setState({ status: "denied" });
      return;
    }
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, (user) => {
      if (!user) setState({ status: "unauthenticated" });
      else void applyBody(reader);
    });
  }, [applyBody, reader, session]);

  return (
    <NoxAuthContext.Provider value={{ state, refresh, logout }}>{children}</NoxAuthContext.Provider>
  );
}
