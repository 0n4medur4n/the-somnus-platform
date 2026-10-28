import { useContext } from "react";
import { NoxAuthContext, type NoxAuthContextValue } from "./NoxAuthContext.js";

export function useNoxAuth(): NoxAuthContextValue {
  const value = useContext(NoxAuthContext);
  if (!value) throw new Error("useNoxAuth requires NoxAuthProvider");
  return value;
}
