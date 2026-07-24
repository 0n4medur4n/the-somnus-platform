import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { consentPurposeKeys } from "./consent-purposes.schema.js";

const id = () => varchar("id", { length: 36 }).primaryKey();
const uuidRef = (name: string) => varchar(name, { length: 36 });

/** One row per purpose (build plan §13): the catalog entry a purpose's versions hang off. */
export const legalDocuments = mysqlTable("legal_documents", {
  id: id(),
  purposeKey: mysqlEnum("purpose_key", consentPurposeKeys).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * `version` is a monotonically increasing integer per document, not a
 * semver string -- "is this the current version" is a MAX(version)
 * query, and "is this receipt superseded" is a strictly-less-than
 * comparison against it. Never mutated once published; a new version
 * is always a new row.
 */
export const legalDocumentVersions = mysqlTable(
  "legal_document_versions",
  {
    id: id(),
    legalDocumentId: uuidRef("legal_document_id").notNull(),
    version: int("version").notNull(),
    locale: mysqlEnum("locale", ["es", "en", "ca", "fr"]).notNull(),
    content: text("content").notNull(),
    effectiveAt: timestamp("effective_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("legal_document_versions_doc_version_locale_idx").on(
      table.legalDocumentId,
      table.version,
      table.locale,
    ),
  ],
);
