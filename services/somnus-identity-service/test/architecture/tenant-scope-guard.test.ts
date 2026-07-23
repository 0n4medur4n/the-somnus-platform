import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static guard for build plan §8: "Every tenant-aware repository
 * method receives an organization or user scope."
 *
 *   findMembership({ organizationId, membershipId });   // correct
 *   findMembershipById(membershipId);                    // forbidden
 *
 * Convention enforced (see any file in src/infrastructure/db/repositories/):
 * every method that SELECTs, UPDATEs, or DELETEs against one of the
 * tables below must declare a parameter literally named `scope`.
 * INSERTs are exempt -- creating a new row already requires supplying
 * the tenant id as a value, which is not the class of bug this guards
 * against (an existing row looked up/mutated without naming its tenant).
 *
 * This is deliberately a plain source scan, not a full type-checker:
 * it is easy to read, easy to extend, and fails loudly (naming the
 * file and method) the moment someone writes a query that skips
 * `scope`. Combined with TenantScope (tenant-scope.ts) making `scope`
 * a required, typed parameter at every call site, this is the
 * "compile-time or lint guard" build plan §20 Checkpoint 6.1 asks for.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPOSITORIES_DIR = join(__dirname, "..", "..", "src", "infrastructure", "db", "repositories");

/** Drizzle schema export name -> true if reading/writing it requires an explicit `scope` parameter. */
const TENANT_SCOPED_TABLES = [
  "individualProfiles",
  "professionalProfiles",
  "organizationLocations",
  "organizationMemberships",
  "organizationInvitations",
  "roleAssignments",
  "accessGrants",
  "accountStatusHistory",
  "sessionRevocations",
  "deletionRequests",
  "identityAuditEvents",
] as const;

/**
 * Deliberate, reviewed exceptions -- each must have a matching
 * "deliberately NOT ...-scoped" comment next to the method it names.
 * A single-use, unguessable invitation token is itself a valid
 * authorization mechanism (the same reasoning a password-reset token
 * relies on): the caller does not have an organizationId to provide
 * yet, only the token from an emailed link.
 */
const EXEMPTIONS = new Set([
  "organization-invitations.repository.ts:findByToken",
  "organization-invitations.repository.ts:accept",
]);

type ExtractedMethod = {
  name: string;
  signature: string;
  body: string;
};

/** Splits a class body into its `async methodName(...) { ... }` members via brace counting (handles nesting). */
function extractMethods(source: string): ExtractedMethod[] {
  const methods: ExtractedMethod[] = [];
  const methodStart = /async\s+(\w+)\s*\(/g;
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec loop
  while ((match = methodStart.exec(source)) !== null) {
    const name = match[1] ?? "";
    const parenStart = match.index + match[0].length - 1;
    const parenEnd = findMatching(source, parenStart, "(", ")");
    if (parenEnd === -1) continue;
    const signature = source.slice(parenStart, parenEnd + 1);

    const braceStart = source.indexOf("{", parenEnd);
    if (braceStart === -1) continue;
    const braceEnd = findMatching(source, braceStart, "{", "}");
    if (braceEnd === -1) continue;
    const body = source.slice(braceStart, braceEnd + 1);

    methods.push({ name, signature, body });
  }
  return methods;
}

function findMatching(source: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function touchesTenantTable(text: string, table: string): boolean {
  // `\s*` between `db` and the method call on purpose: this codebase's
  // style chains `this.db\n  .update(...)` across lines, not
  // `this.db.update(...)` on one line -- a literal `db\.update\(`
  // (no `\s*`) would silently never match any of these real calls.
  const patterns = [
    new RegExp(`\\.from\\(\\s*${table}\\b`),
    new RegExp(`db\\s*\\.update\\(\\s*${table}\\b`),
    new RegExp(`db\\s*\\.delete\\(\\s*${table}\\b`),
  ];
  return patterns.some((p) => p.test(text));
}

function hasScopeParameter(signature: string): boolean {
  return (
    /\bscope\s*:/.test(signature) || /\bscope\s*,/.test(signature) || /\bscope\s*\)/.test(signature)
  );
}

describe("tenant scope guard (build plan §8)", () => {
  const files = readdirSync(REPOSITORIES_DIR).filter(
    (f) => f.endsWith(".repository.ts") && !f.endsWith(".test.ts"),
  );

  it("finds at least one repository file to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)(
    "%s: every tenant-table query method declares an explicit `scope` parameter",
    (file) => {
      const source = readFileSync(join(REPOSITORIES_DIR, file), "utf-8");
      const methods = extractMethods(source);
      const violations: string[] = [];

      for (const method of methods) {
        const touchedTables = TENANT_SCOPED_TABLES.filter((table) =>
          touchesTenantTable(method.body, table),
        );
        if (touchedTables.length === 0) continue;
        if (EXEMPTIONS.has(`${file}:${method.name}`)) continue;
        if (!hasScopeParameter(method.signature)) {
          violations.push(
            `${method.name}(${touchedTables.join(", ")}) is missing a \`scope\` parameter`,
          );
        }
      }

      expect(violations, `Unscoped tenant queries in ${file}:\n${violations.join("\n")}`).toEqual(
        [],
      );
    },
  );

  it("every exemption still names a real, tenant-table-touching method (no stale escape hatches)", () => {
    const stale: string[] = [];
    for (const exemption of EXEMPTIONS) {
      const [file, methodName] = exemption.split(":");
      const source = readFileSync(join(REPOSITORIES_DIR, file ?? ""), "utf-8");
      const method = extractMethods(source).find((m) => m.name === methodName);
      const touchesAny = method
        ? TENANT_SCOPED_TABLES.some((table) => touchesTenantTable(method.body, table))
        : false;
      if (!method || !touchesAny) stale.push(exemption);
    }
    expect(
      stale,
      `Stale exemptions (method missing or no longer touches a tenant table): ${stale.join(", ")}`,
    ).toEqual([]);
  });
});
