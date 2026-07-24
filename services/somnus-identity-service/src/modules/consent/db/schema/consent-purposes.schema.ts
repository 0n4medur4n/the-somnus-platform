import { boolean, mysqlEnum, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

const id = () => varchar("id", { length: 36 }).primaryKey();

/** Build plan §13: never combine legal permissions into one checkbox. Mirrors @somnus/api-contracts's CONSENT_PURPOSE_KEYS. */
export const consentPurposeKeys = [
  "terms_acceptance",
  "privacy_policy_acknowledgement",
  "health_data_processing",
  "professional_sharing",
  "marketing",
  "research_participation",
] as const;

/** Reference/catalog table, seeded once via migration -- same pattern as identity's `roles` table. */
export const consentPurposes = mysqlTable("consent_purposes", {
  id: id(),
  key: mysqlEnum("key", consentPurposeKeys).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  isRequired: boolean("is_required").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
