import { mysqlEnum, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { consentPurposeKeys } from "./consent-purposes.schema.js";

const id = () => varchar("id", { length: 36 }).primaryKey();
const uuidRef = (name: string) => varchar(name, { length: 36 });

/** Build plan §13: user, purpose, document version, timestamp, source, optional organization context. */
export const consentReceipts = mysqlTable("consent_receipts", {
  id: id(),
  userId: uuidRef("user_id").notNull(),
  purposeKey: mysqlEnum("purpose_key", consentPurposeKeys).notNull(),
  legalDocumentVersionId: uuidRef("legal_document_version_id").notNull(),
  organizationId: uuidRef("organization_id"),
  source: varchar("source", { length: 120 }).notNull(),
  consentedAt: timestamp("consented_at").notNull().defaultNow(),
});

/**
 * A separate table, not a `withdrawnAt` column on consent_receipts
 * (build plan §13 lists them as two tables): a withdrawal is its own
 * auditable event with its own timestamp/reason, not a mutation of
 * the original receipt. `receiptId` is unique -- a receipt can be
 * withdrawn at most once; re-consenting creates a new receipt row.
 */
export const consentWithdrawals = mysqlTable("consent_withdrawals", {
  id: id(),
  receiptId: uuidRef("receipt_id").notNull().unique(),
  userId: uuidRef("user_id").notNull(),
  reason: varchar("reason", { length: 500 }),
  withdrawnAt: timestamp("withdrawn_at").notNull().defaultNow(),
});
