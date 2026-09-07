import { useContext } from "react";
import { AdminAuthContext, type AdminAuthContextValue } from "./AdminAuthContext.js";

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within an AdminAuthProvider");
  return ctx;
}
