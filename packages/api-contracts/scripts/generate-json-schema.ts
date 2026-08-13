/**
 * Generate the cross-language JSON Schema artifacts for the edge <-> morpheo
 * contract (build plan §3.4: generated from Zod, never hand-written; §19: the
 * edge <-> morpheo boundary is contract-tested on both sides).
 *
 * Morpheo is the only Python provider, so its contract cannot ride NestJS's
 * OpenAPI generator. Instead we emit standalone JSON Schema (Draft 2020-12)
 * that the Python contract test loads and validates its DTOs against. Run:
 *   pnpm --filter @somnus/api-contracts generate:json-schema
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MORPHEO_CONTRACT_SCHEMAS } from "../src/morpheo/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "..", "..", "schemas", "json-schema", "morpheo");

mkdirSync(OUT_DIR, { recursive: true });

for (const [name, schema] of Object.entries(MORPHEO_CONTRACT_SCHEMAS)) {
  const jsonSchema = z.toJSONSchema(schema);
  const path = resolve(OUT_DIR, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(jsonSchema, null, 2)}\n`);
  // biome-ignore lint/suspicious/noConsole: progress output for a dev generator script
  console.log(`wrote ${path}`);
}
