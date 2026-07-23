import { z } from "zod";

/** Build plan §11. Professional specialty is profile data, never a role -- see professional.ts. */
export const ROLE_KEYS = [
  "individual_user",
  "professional",
  "organization_owner",
  "organization_admin",
  "professional_manager",
  "clinical_supervisor",
  "support_agent",
  "professional_verifier",
  "clinical_governance_reviewer",
  "platform_admin",
  "platform_super_admin",
] as const;

export const RoleKeySchema = z.enum(ROLE_KEYS);
export type RoleKey = z.infer<typeof RoleKeySchema>;

export const INTERNAL_ROLE_KEYS: ReadonlySet<RoleKey> = new Set([
  "support_agent",
  "professional_verifier",
  "clinical_governance_reviewer",
  "platform_admin",
  "platform_super_admin",
]);
