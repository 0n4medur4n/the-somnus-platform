/**
 * No `.references()` foreign-key constraints, for the same reason as
 * identity's schema (see infrastructure/db/schema/index.ts): TiDB
 * Cloud is a distributed SQL database, and referential integrity is
 * enforced by the repository layer instead.
 */
export * from "./audit.schema.js";
export * from "./consent-purposes.schema.js";
export * from "./consent-receipts.schema.js";
export * from "./legal-documents.schema.js";
