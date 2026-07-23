import {
  date,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** UUIDv7 primary/foreign keys everywhere (build plan §12): app-generated, never DB auto-increment. */
const id = () => varchar("id", { length: 36 }).primaryKey();
const uuidRef = (name: string) => varchar(name, { length: 36 });

export const users = mysqlTable("users", {
  id: id(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  locale: mysqlEnum("locale", ["es", "en", "ca", "fr"]).notNull().default("es"),
  status: mysqlEnum("status", ["active", "suspended", "deleted"]).notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const userIdentities = mysqlTable(
  "user_identities",
  {
    id: id(),
    userId: uuidRef("user_id").notNull(),
    provider: mysqlEnum("provider", ["firebase"]).notNull().default("firebase"),
    providerUserId: varchar("provider_user_id", { length: 128 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_identities_provider_uid_idx").on(table.provider, table.providerUserId),
  ],
);

export const individualProfiles = mysqlTable("individual_profiles", {
  id: id(),
  userId: uuidRef("user_id").notNull().unique(),
  firstName: varchar("first_name", { length: 120 }).notNull(),
  lastName: varchar("last_name", { length: 120 }).notNull(),
  // mode: "string" -- a date of birth is a calendar date, not an
  // instant; keeping it as "YYYY-MM-DD" avoids timezone conversion
  // footguns Date objects would introduce for no benefit here.
  dateOfBirth: date("date_of_birth", { mode: "string" }),
  phone: varchar("phone", { length: 32 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const professionalSpecialties = [
  "family_physician",
  "pediatrician",
  "sleep_physician",
  "psychologist",
  "nurse",
  "pharmacist",
  "therapist",
] as const;

export const professionalProfiles = mysqlTable("professional_profiles", {
  id: id(),
  userId: uuidRef("user_id").notNull().unique(),
  specialty: mysqlEnum("specialty", professionalSpecialties).notNull(),
  licenseNumber: varchar("license_number", { length: 64 }).notNull(),
  verificationStatus: mysqlEnum("verification_status", ["pending", "verified", "rejected"])
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const professionalCredentials = mysqlTable("professional_credentials", {
  id: id(),
  professionalProfileId: uuidRef("professional_profile_id").notNull(),
  credentialType: varchar("credential_type", { length: 120 }).notNull(),
  issuer: varchar("issuer", { length: 200 }).notNull(),
  issuedAt: date("issued_at", { mode: "string" }),
  expiresAt: date("expires_at", { mode: "string" }),
  documentUrl: varchar("document_url", { length: 500 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const professionalVerificationCases = mysqlTable("professional_verification_cases", {
  id: id(),
  professionalProfileId: uuidRef("professional_profile_id").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).notNull().default("pending"),
  reviewerId: uuidRef("reviewer_id"),
  reviewedAt: timestamp("reviewed_at"),
  notes: varchar("notes", { length: 2000 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});
