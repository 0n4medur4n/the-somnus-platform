/**
 * No `.references()` foreign-key constraints, matching the identity/consent
 * schemas: TiDB Cloud is a distributed SQL database and referential integrity is
 * enforced by the repository layer instead.
 */
export * from "./notification-deliveries.schema.js";
