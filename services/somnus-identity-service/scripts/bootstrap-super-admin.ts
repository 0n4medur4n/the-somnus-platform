/**
 * One-time platform bootstrap: grant the very first `platform_super_admin`
 * (Addendum A §A5.4).
 *
 * **This is never run automatically.** Not on service boot, not from a
 * migration, not from a deploy pipeline. It is an operator action, invoked by
 * hand, once per environment. See `docs/runbooks/deploy-dev.md`.
 *
 * Why it exists: §A2.2 makes `platform_super_admin` the only role that can
 * assign internal roles, so an environment with none has no way to create the
 * first one. Every later assignment goes through the console.
 *
 * How it is constrained:
 *
 * - The email is read from **Secret Manager at runtime**, by secret NAME. It is
 *   never an argument, never an env-var default, never in this file, and is
 *   never printed -- not in success output, not in an error. The only thing
 *   echoed about the person is the opaque Somnus user id.
 * - It **finds** an existing account. It never creates one: the person must
 *   have registered through the normal magic-link flow first, so the account is
 *   one they actually control.
 * - It assigns through `InternalRolesService`, the same method the console
 *   uses. No parallel insert.
 * - That service refuses this path once ANY `platform_super_admin` exists, so
 *   running it twice is a conflict, and the script is a door that closes rather
 *   than a standing backdoor.
 *
 * Usage:
 *   pnpm --filter @somnus/identity-service bootstrap:super-admin
 *
 * Required environment: `GCP_PROJECT_ID` (which project's Secret Manager to
 * read), `DATABASE_URL` / `DB_SSL`, and Application Default Credentials with
 * `roles/secretmanager.secretAccessor` on the secret.
 */

import { GoogleAuth } from "google-auth-library";
import { createDb, createPool } from "../src/infrastructure/db/db.client.js";
import { loadDbConfig } from "../src/infrastructure/db/db.config.js";
import { RoleAssignmentsRepository } from "../src/infrastructure/db/repositories/role-assignments.repository.js";
import { RolesRepository } from "../src/infrastructure/db/repositories/roles.repository.js";
import { UsersRepository } from "../src/infrastructure/db/repositories/users.repository.js";
import { LoggingEventPublisher } from "../src/infrastructure/events/logging-event-publisher.js";
import { InternalRolesService } from "../src/modules/admin/internal-roles.service.js";

/** The secret holding the bootstrap address. Referenced by NAME only, ever. */
const SECRET_ID = process.env["BOOTSTRAP_SECRET_ID"] ?? "BOOTSTRAP_SUPER_ADMIN_EMAIL";

function fail(message: string): never {
  process.stderr.write(`bootstrap-super-admin: ${message}\n`);
  process.exit(1);
}

/**
 * Reads the latest version of the secret. Returns the value to exactly one
 * caller and is never logged, echoed, or included in an error message: an
 * operator reading this script's output must not learn the address from it.
 */
async function readBootstrapEmail(projectId: string): Promise<string> {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const token = await auth.getAccessToken();
  if (!token) fail("could not obtain Google credentials (is ADC configured?)");

  const url = `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets/${SECRET_ID}/versions/latest:access`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) {
    fail(
      `could not read secret "${SECRET_ID}" from project "${projectId}" (HTTP ${response.status}). ` +
        "Check the secret exists and the caller has roles/secretmanager.secretAccessor.",
    );
  }

  const body = (await response.json()) as { payload?: { data?: string } };
  const encoded = body.payload?.data;
  if (!encoded) fail(`secret "${SECRET_ID}" has no value set`);

  const email = Buffer.from(encoded, "base64").toString("utf8").trim();
  if (email.length === 0) fail(`secret "${SECRET_ID}" is empty`);
  return email;
}

async function main(): Promise<void> {
  const projectId = process.env["GCP_PROJECT_ID"];
  if (!projectId) fail("GCP_PROJECT_ID is required (which project's Secret Manager to read)");

  const email = await readBootstrapEmail(projectId);

  const pool = createPool(loadDbConfig(process.env));
  const db = createDb(pool);
  const users = new UsersRepository(db);

  try {
    const account = await users.findByEmail(email);
    if (!account) {
      // Deliberately does not name the address: the operator knows who they
      // put in the secret, and this output may be pasted anywhere.
      fail(
        "no account exists for the address in the secret. The person must register " +
          "through the normal magic-link flow first; this script never creates an account.",
      );
    }

    const service = new InternalRolesService(
      users,
      new RolesRepository(db),
      new RoleAssignmentsRepository(db),
      new LoggingEventPublisher(),
    );

    const result = await service.assignInternalRole({
      targetUserId: account.id,
      roleKey: "platform_super_admin",
      source: { kind: "bootstrap" },
      correlationId: `bootstrap-${Date.now()}`,
    });

    process.stdout.write(
      `bootstrap-super-admin: granted platform_super_admin\n` +
        `  userId:       ${result.targetUserId}\n` +
        `  assignmentId: ${result.assignmentId}\n` +
        `  source:       ${result.source}\n` +
        `Audited as admin.internal_role.assigned.v1 with source="bootstrap".\n` +
        `Every later assignment goes through the admin console; this path is now closed.\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // Error messages from the layers below never carry the address, and this
  // does not add it.
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
