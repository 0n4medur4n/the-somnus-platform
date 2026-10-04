/**
 * One log line for an error nothing else handled: enough to diagnose it, and
 * nothing that can leak.
 *
 * ## Why this exists
 *
 * The exception filter used to log `exception.message` and nothing else. For a
 * database failure that was wrong twice over:
 *
 *  - **It hid the cause.** Drizzle wraps every driver failure in a
 *    `DrizzleQueryError` whose message is only `Failed query: <sql>`. The mysql2
 *    error that says *why* -- `ER_NO_SUCH_TABLE`, `ER_ACCESS_DENIED_ERROR`,
 *    `ETIMEDOUT` -- sits in `.cause` and was never read. On 2026-09-19 that
 *    turned "the DSN names the wrong database" into hours of inference, because
 *    every failure logged the same opaque line.
 *  - **It leaked the bound values.** Drizzle builds that message as
 *    `Failed query: ${query}\nparams: ${params}`, so every failed query printed
 *    its parameters -- an email address, a token, whatever the caller passed.
 *
 * So for a `DrizzleQueryError` the message is never logged at all: the SQL text
 * is (it carries `?` placeholders, never values -- identity builds no SQL with
 * `sql.raw`), and the driver's `code`, `errno` and `sqlState` are read off the
 * cause chain. Every other message, at every level, goes through
 * `scrubMessage`.
 *
 * mysql2's own `.sql` property is never read: unlike Drizzle's query text, it
 * can hold the statement with its values already formatted in.
 */

const MAX_MESSAGE_LENGTH = 300;
const MAX_QUERY_LENGTH = 400;
/** Drizzle wraps once and mysql2 rarely nests; three levels is more than seen. */
const MAX_CAUSE_DEPTH = 3;

const REDACTED = "<redacted>";

/**
 * A quoted literal kept verbatim only if it reads as a schema object name --
 * `table`, `db.table`, `db.table.column`. That is what makes
 * `Table 'somnus_audit.legal_documents' doesn't exist` diagnosable. Anything
 * else in quotes may be data and is redacted.
 */
const SCHEMA_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*){0,2}$/;

/** The structural shape of drizzle-orm's `DrizzleQueryError`. */
type QueryErrorShape = Error & { query: string; params: unknown[] };

/**
 * Matched by shape, not `instanceof`: the class sets no `.name`, and a second
 * copy of drizzle-orm in the dependency tree would defeat `instanceof` without
 * anyone noticing -- and the failure mode of a miss is logging the params.
 */
function isDrizzleQueryError(error: Error): error is QueryErrorShape {
  const candidate = error as Partial<Record<"query" | "params", unknown>>;
  return typeof candidate.query === "string" && Array.isArray(candidate.params);
}

/**
 * `DrizzleQueryError` never sets `.name`, so it reports as plain `Error`. The
 * constructor name is the one that says what actually happened.
 */
function errorName(error: Error): string {
  const constructorName = (error.constructor as { name?: unknown } | undefined)?.name;
  if (typeof constructorName === "string" && constructorName.length > 0) return constructorName;
  return error.name;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Only short tokens of the shape drivers actually use (`ER_NO_SUCH_TABLE`,
 * `1146`, `42S02`, `ETIMEDOUT`). Anything else -- a custom error that put
 * free text in `.code` -- is dropped rather than echoed.
 */
function driverToken(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(value)) return value;
  return null;
}

function driverFields(error: object): string[] {
  const fields = error as Partial<Record<"code" | "errno" | "sqlState", unknown>>;
  const out: string[] = [];
  for (const key of ["code", "errno", "sqlState"] as const) {
    const token = driverToken(fields[key]);
    if (token !== null) out.push(`${key}=${token}`);
  }
  return out;
}

/**
 * Removes anything in an error message that could be a credential or user
 * data, keeping what an operator needs to diagnose the failure.
 *
 * Covers what database and HTTP errors actually put in messages:
 *  - the userinfo of any URL (`mysql://user:pass@host` -> `mysql://<redacted>@host`);
 *  - MySQL's `Access denied for user 'u'@'h'`;
 *  - values MySQL echoes back (`Duplicate entry '…'`, `Incorrect … value: '…'`);
 *  - any other quoted literal that is not a schema object name;
 *  - `password=…`, `token: …` and the like, `Bearer …`, and JWT-shaped strings;
 *  - anything after `params:`, wherever a wrapped Drizzle message surfaces.
 *
 * It cannot recognise a secret that code wrote into a message as free prose --
 * no pattern can. The guarantee is about the shapes above.
 */
export function scrubMessage(raw: string): string {
  let text = raw;

  // Drizzle's bound values follow "params:". Cut them before anything else, so
  // no later rule has to be right about what they look like.
  const paramsAt = text.search(/\bparams:/i);
  if (paramsAt !== -1) text = text.slice(0, paramsAt);

  // Contractions first, so the apostrophe in "doesn't" or "Can't" is not read
  // as the opening quote of a literal running into the next real one.
  text = text.replace(/(\w)'(t|s|re|ve|ll|d|m)\b/gi, "$1’$2");

  text = text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)\S*@/gi, `$1${REDACTED}@`);
  text = text.replace(/(for user\s+)'[^']*'(?:@'[^']*')?/gi, `$1'${REDACTED}'@'${REDACTED}'`);
  text = text.replace(/\b(entry|value:?)\s*'(?:[^'\\]|\\.)*'/gi, `$1 '${REDACTED}'`);
  text = text.replace(/'((?:[^'\\]|\\.)*)'/g, (literal, inner: string) =>
    SCHEMA_IDENTIFIER.test(inner) ? literal : `'${REDACTED}'`,
  );
  text = text.replace(
    /\b(password|passwd|pwd|secret|token|api[_-]?key)(\s*[=:]\s*)\S+/gi,
    `$1$2${REDACTED}`,
  );
  text = text.replace(/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`);
  text = text.replace(/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, REDACTED);

  return truncate(oneLine(text), MAX_MESSAGE_LENGTH);
}

/** The error's own description, without its causes. */
function describeOne(error: Error): string {
  const parts = [errorName(error), ...driverFields(error)];
  if (isDrizzleQueryError(error)) {
    // `.message` is `Failed query: …\nparams: …`. The query text is safe and is
    // what says which table; the message would add only the params.
    parts.push(`query="${truncate(oneLine(error.query), MAX_QUERY_LENGTH)}"`);
  } else {
    parts.push(`message="${scrubMessage(error.message)}"`);
  }
  return parts.join(" ");
}

/**
 * Describes an unhandled exception for the operator log: its type, the SQL
 * text if it was a query, and every cause's driver `code`, `errno` and
 * `sqlState` with a scrubbed message.
 *
 * Never includes query params, a DSN's credentials, mysql2's formatted `.sql`,
 * or a stack trace.
 */
export function describeUnhandledError(exception: unknown): string {
  if (!(exception instanceof Error)) {
    // A thrown string or object could be anything at all; its type is all
    // that is safe to say about it.
    return `non-Error value thrown (${exception === null ? "null" : typeof exception})`;
  }

  const parts = [describeOne(exception)];
  const seen = new Set<unknown>([exception]);
  let cause: unknown = exception.cause;

  for (let depth = 1; depth <= MAX_CAUSE_DEPTH && cause !== undefined; depth++) {
    if (seen.has(cause)) {
      parts.push("cause: (cycle)");
      break;
    }
    seen.add(cause);

    if (cause instanceof Error) {
      parts.push(`cause: ${describeOne(cause)}`);
      cause = cause.cause;
    } else if (typeof cause === "object" && cause !== null) {
      // Some drivers reject with plain objects that still carry the codes.
      const fields = driverFields(cause);
      parts.push(`cause: object${fields.length > 0 ? ` ${fields.join(" ")}` : ""}`);
      break;
    } else {
      parts.push(`cause: (${typeof cause})`);
      break;
    }
  }

  return parts.join(" | ");
}
