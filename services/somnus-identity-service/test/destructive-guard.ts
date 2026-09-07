/**
 * The safety interlock for the destructive test setup.
 *
 * `global-setup.ts` drops **every table** in the database it is handed. Until
 * this guard existed, the only things standing between that and a production
 * database were a secret's *name* in one CI workflow line and the fact that no
 * production DSN happened to be configured. Both are conventions, and neither
 * travels with the code: a laptop, a new pipeline, or a one-line edit to
 * `ci.yml` would have been enough.
 *
 * This does travel with the code. It runs before any pool is opened, on every
 * machine the suite ever runs on, and it fails closed on anything it cannot
 * positively recognise as a disposable target.
 *
 * Three independent conditions, all required:
 *
 * 1. **Explicit opt-in.** `SOMNUS_ALLOW_DESTRUCTIVE_TESTS=1` must be set. Nothing
 *    destructive happens by merely running a test command.
 * 2. **Database-name allowlist.** Only `somnus_identity` and `somnus_consent`.
 *    This catches a DSN aimed at the wrong logical database (`somnus_morpheo`,
 *    `somnus_reporting`, anything else). It does NOT distinguish dev from
 *    production, because production uses the same names -- which is exactly why
 *    condition 3 exists and is not optional.
 * 3. **Host allowlist.** Loopback is always allowed: it cannot be production by
 *    construction. **Every other host must be named explicitly** in
 *    `SOMNUS_DESTRUCTIVE_TEST_HOSTS`. A shared dev cluster is reachable only
 *    because someone deliberately listed it, in that environment's
 *    configuration; a production host is unreachable unless someone writes it
 *    down next to a variable called "destructive test hosts", which is not a
 *    thing anyone does by accident.
 *
 * No credential ever reaches an error message. Failures name the host and the
 * database, both of which are already non-secret, and nothing else.
 */

export const DESTRUCTIVE_OPT_IN_ENV = "SOMNUS_ALLOW_DESTRUCTIVE_TESTS";
export const DESTRUCTIVE_HOSTS_ENV = "SOMNUS_DESTRUCTIVE_TEST_HOSTS";

/** The only databases this suite owns and may therefore destroy. */
export const ALLOWED_DATABASES: ReadonlyArray<string> = ["somnus_identity", "somnus_consent"];

/** Hosts that cannot be production by construction, so they need no listing. */
export const LOOPBACK_HOSTS: ReadonlyArray<string> = ["localhost", "127.0.0.1", "::1", "[::1]"];

/** Thrown instead of dropping anything. Distinct so a test can prove the abort came from here. */
export class DestructiveTestGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DestructiveTestGuardError";
  }
}

function refuse(reason: string): never {
  throw new DestructiveTestGuardError(
    `Refusing to drop tables: ${reason}. ` +
      `This suite deletes every table in its target database. See test/destructive-guard.ts.`,
  );
}

type ParsedTarget = { host: string; database: string };

/**
 * Pulls the host and database out of a DSN without ever surfacing the
 * credentials in it. An unparseable DSN is a refusal, not a best guess.
 */
function parseTarget(dsn: string): ParsedTarget {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    // Deliberately does not echo the DSN: it contains a password.
    refuse("the connection string could not be parsed, so its target is unknown");
  }

  const host = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")).trim();
  if (host.length === 0) refuse("the connection string names no host");
  if (database.length === 0) refuse("the connection string names no database");
  return { host, database };
}

function allowedHosts(env: NodeJS.ProcessEnv): string[] {
  return (env[DESTRUCTIVE_HOSTS_ENV] ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

/**
 * Throws unless this exact target is a disposable one. Call it BEFORE opening a
 * pool, so a refusal costs nothing and touches nothing.
 *
 * `label` only appears in the message, to say which of the two databases was
 * rejected.
 */
export function assertDestructiveTargetAllowed(
  dsn: string,
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env[DESTRUCTIVE_OPT_IN_ENV] !== "1") {
    refuse(
      `${DESTRUCTIVE_OPT_IN_ENV} is not set to "1" (${label}). ` +
        "Destructive test setup never runs without an explicit opt-in",
    );
  }

  const { host, database } = parseTarget(dsn);

  if (!ALLOWED_DATABASES.includes(database)) {
    refuse(
      `database "${database}" (${label}) is not one this suite owns. ` +
        `Allowed: ${ALLOWED_DATABASES.join(", ")}`,
    );
  }

  if (LOOPBACK_HOSTS.includes(host)) return;

  const allowed = allowedHosts(env);
  if (!allowed.includes(host)) {
    refuse(
      `host "${host}" (${label}) is not loopback and is not listed in ` +
        `${DESTRUCTIVE_HOSTS_ENV}. A non-local database is only ever a valid ` +
        "target if someone deliberately named it there",
    );
  }
}

/** `host:port/database`, lowercased. Never includes the userinfo. */
function locate(dsn: string, label: string): string {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    refuse(`the ${label} connection string could not be parsed, so its target is unknown`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")).trim();
  if (url.hostname.length === 0) refuse(`the ${label} connection string names no host`);
  if (database.length === 0) refuse(`the ${label} connection string names no database`);
  return `${url.hostname.toLowerCase()}:${url.port}/${database}`;
}

/**
 * Refuses when the two destructive targets are one and the same database.
 *
 * `global-setup.ts` drops every table in each target in turn, and each drop is
 * scoped by MySQL's `DATABASE()` -- which is precisely what keeps identity out
 * of consent and vice versa (ADR 0010). That scoping silently stops meaning
 * anything the moment both DSNs name one database: the consent pass drops the
 * identity tables the identity pass has just created, then migrates only
 * consent's, and the run continues into a schema missing half of itself. The
 * first symptom appears files later, as a DELETE against a table that no longer
 * exists, pointing at nothing in particular.
 *
 * This is reachable from a one-character mistake. CI derives the consent DSN
 * from identity's by literal substitution (`s#/somnus_identity#/somnus_consent#`),
 * so any DATABASE_URL whose path is not exactly `/somnus_identity` leaves the
 * substitution a no-op and collapses the two into one.
 *
 * The database allowlist cannot catch it: `somnus_identity` and `somnus_consent`
 * are both allowed, so an identical pair satisfies every check that already
 * existed. Hence a separate one, and hence it runs before any pool is opened --
 * a half-wiped database is not a safer outcome than a refusal.
 */
export function assertTargetsAreDistinct(identityDsn: string, consentDsn: string): void {
  const identity = locate(identityDsn, "identity");
  const consent = locate(consentDsn, "consent");

  if (identity === consent) {
    refuse(
      `the identity and consent targets are the same database (${identity}). ` +
        "Each is dropped in turn, so the second pass would destroy the first's " +
        "tables. Check that DATABASE_URL's path is exactly /somnus_identity, " +
        "which is what CI's CONSENT_DATABASE_URL derivation substitutes on",
    );
  }
}
