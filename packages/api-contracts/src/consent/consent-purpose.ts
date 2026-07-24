import { z } from "zod";

/**
 * Build plan §13: "Never combine legal permissions into one checkbox."
 * Each of these is recorded, granted, and withdrawn independently.
 */
export const CONSENT_PURPOSE_KEYS = [
  "terms_acceptance",
  "privacy_policy_acknowledgement",
  "health_data_processing",
  "professional_sharing",
  "marketing",
  "research_participation",
] as const;

export const ConsentPurposeKeySchema = z.enum(CONSENT_PURPOSE_KEYS);
export type ConsentPurposeKey = z.infer<typeof ConsentPurposeKeySchema>;

/** Purposes the platform cannot function without; the other three are optional opt-ins. */
export const REQUIRED_CONSENT_PURPOSE_KEYS: ReadonlySet<ConsentPurposeKey> = new Set([
  "terms_acceptance",
  "privacy_policy_acknowledgement",
  "health_data_processing",
]);
