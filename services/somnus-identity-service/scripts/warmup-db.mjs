/**
 * Resume the TiDB Serverless dev cluster before the timed integration
 * tests run. TiDB Serverless scales to zero when idle; the first query
 * from a cold cluster (or a freshly opened connection to it) pays a
 * resume/handshake cost that can exceed a test's timeout -- or throw
 * mid-request and surface as an INTERNAL 500 -- even though the code is
 * correct. A plain `SELECT 1` retried until it succeeds means the suite
 * starts against an already-warm cluster.
 *
 * Warms BOTH databases the identity suite uses -- somnus_identity
 * (DATABASE_URL) and somnus_consent (CONSENT_DATABASE_URL). The cluster
 * resume is cluster-wide, but each database is reached over its own
 * connection, so touching both here establishes both before the tests
 * (the consent cross-module test opens a consent connection mid-suite
 * and was the one flaking).
 *
 * Reads *_DATABASE_URL / *_DB_SSL from the environment (the CI job sets
 * them). No-ops fast against a warm cluster.
 */
import mysql from "mysql2/promise";

const targets = [
  { name: "identity", url: process.env["DATABASE_URL"], ssl: process.env["DB_SSL"] === "true" },
  {
    name: "consent",
    url: process.env["CONSENT_DATABASE_URL"],
    ssl: process.env["CONSENT_DB_SSL"] === "true",
  },
].filter((t) => t.url);

if (targets.length === 0) {
  console.error("[warmup] no DATABASE_URL / CONSENT_DATABASE_URL set");
  process.exit(1);
}

const MAX_ATTEMPTS = 40;
const DELAY_MS = 3000;

async function warm(target) {
  const ssl = target.ssl ? { minVersion: "TLSv1.2" } : undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const conn = await mysql.createConnection({ uri: target.url, ...(ssl ? { ssl } : {}) });
      await conn.query("SELECT 1");
      await conn.end();
      console.warn(`[warmup] ${target.name} responsive after ${attempt} attempt(s)`);
      return;
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? err.code : String(err);
      console.warn(`[warmup] ${target.name} attempt ${attempt}/${MAX_ATTEMPTS}: ${code}`);
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }
  throw new Error(`[warmup] ${target.name} did not become responsive within the resume window`);
}

try {
  for (const target of targets) {
    await warm(target);
  }
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
