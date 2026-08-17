/**
 * Generate the cross-language JSON Schema artifacts for the Python-provider
 * boundaries (build plan §3.4: generated from Zod, never hand-written; §19:
 * these boundaries are contract-tested on both sides).
 *
 * The Python services (morpheo, report) cannot ride NestJS's OpenAPI generator,
 * so we emit standalone JSON Schema (Draft 2020-12) that each Python contract
 * test loads and validates its DTOs against. Run:
 *   pnpm --filter @somnus/api-contracts generate:json-schema
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MORPHEO_CONTRACT_SCHEMAS } from "../src/morpheo/index.js";
import { REPORT_CONTRACT_SCHEMAS } from "../src/report/index.js";

const GROUPS: Record<string, Record<string, z.ZodType>> = {
  morpheo: MORPHEO_CONTRACT_SCHEMAS,
  report: REPORT_CONTRACT_SCHEMAS,
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_ROOT = resolve(__dirname, "..", "..", "..", "schemas", "json-schema");

for (const [group, schemas] of Object.entries(GROUPS)) {
  const outDir = resolve(SCHEMAS_ROOT, group);
  mkdirSync(outDir, { recursive: true });
  for (const [name, schema] of Object.entries(schemas)) {
    const path = resolve(outDir, `${name}.json`);
    writeFileSync(path, `${JSON.stringify(z.toJSONSchema(schema), null, 2)}\n`);
    // biome-ignore lint/suspicious/noConsole: progress output for a dev generator script
    console.log(`wrote ${path}`);
  }
}
