/**
 * No `.references()` foreign-key constraints anywhere in this schema,
 * deliberately: TiDB Cloud (build plan §3.9) is a distributed SQL
 * database where cross-region FK enforcement adds write-path latency
 * for a guarantee application code already provides. Referential
 * integrity is enforced by the repository layer (every write goes
 * through a repository method, never raw SQL), the same layer that
 * enforces tenant scoping (see tenant-scope.ts).
 */
export * from "./access.schema.js";
export * from "./audit.schema.js";
export * from "./organizations.schema.js";
export * from "./roles.schema.js";
export * from "./users.schema.js";
