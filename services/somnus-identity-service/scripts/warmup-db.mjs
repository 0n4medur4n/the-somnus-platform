/**
 * Resume the TiDB Serverless dev cluster before the timed integration
 * tests run. TiDB Serverless scales to zero when idle; the first query
 * from a cold cluster pays a resume cost that can exceed a test's
 * timeout even though the code is correct. Running this first -- a
 * plain `SELECT 1` retried until it succeeds -- means the suite starts
 * against an already-warm cluster.
 *
 * Reads DATABASE_URL / DB_SSL from the environment (the CI job sets
 * them). No-ops fast against a warm cluster; on a cold one it retries
 * for up to ~2 minutes, which is the resume window TiDB documents.
 */
import mysql from "mysql2/promise";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("[warmup] DATABASE_URL not set");
  process.exit(1);
}
const ssl = process.env["DB_SSL"] === "true" ? { minVersion: "TLSv1.2" } : undefined;

const MAX_ATTEMPTS = 40;
const DELAY_MS = 3000;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    const conn = await mysql.createConnection({ uri: url, ...(ssl ? { ssl } : {}) });
    await conn.query("SELECT 1");
    await conn.end();
    console.warn(`[warmup] TiDB responsive after ${attempt} attempt(s)`);
    process.exit(0);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : String(err);
    console.warn(`[warmup] attempt ${attempt}/${MAX_ATTEMPTS}: ${code}`);
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
}

console.error("[warmup] TiDB did not become responsive within the resume window");
process.exit(1);
