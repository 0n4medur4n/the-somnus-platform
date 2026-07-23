import type { UUIDv7 } from "@somnus/api-contracts";

/**
 * Build plan §8: "Every tenant-aware repository method receives an
 * organization or user scope." These types are the required first
 * parameter of every tenant-sensitive repository method -- TypeScript
 * refuses to compile a call site that omits one (compile-time half of
 * the guard). The runtime half -- proving the scope is actually used
 * in the query, not just accepted and ignored -- is
 * `test/architecture/tenant-scope-guard.test.ts`.
 *
 * See services/somnus-identity-service/README.md#tenant-scoping.
 */
export type OrgScope = { readonly organizationId: UUIDv7 };
export type UserScope = { readonly userId: UUIDv7 };
