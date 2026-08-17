/**
 * The report service contract (build plan §20 Checkpoint 11.1). Same two
 * claims as the morpheo contract: the Zod schemas accept/reject correctly, and
 * the checked-in JSON Schema artifacts under schemas/json-schema/report/ still
 * equal what `z.toJSONSchema` produces (the drift guard the Python provider
 * validates against).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { REPORT_CONTRACT_SCHEMAS, ReportRefSchema, ReportRenderRequestSchema } from "./render.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = resolve(__dirname, "..", "..", "..", "..", "schemas", "json-schema", "report");

describe("generated JSON Schema artifacts stay in sync with the Zod source", () => {
  for (const [name, schema] of Object.entries(REPORT_CONTRACT_SCHEMAS)) {
    it(`${name}.json equals z.toJSONSchema(${name})`, () => {
      const onDisk = JSON.parse(readFileSync(resolve(ARTIFACT_DIR, `${name}.json`), "utf8"));
      expect(onDisk).toEqual(z.toJSONSchema(schema));
    });
  }
});

const VALID_REQUEST = {
  assessmentId: "a1",
  definitionVersion: "1.0",
  contentVersion: "1.1",
  locale: "es",
  role: "adult",
  level: "L1",
  stop: true,
  triggeredRules: ["SAFE-003"],
  routes: ["SLP"],
  completedAt: "2026-08-17T12:00:00Z",
};

describe("ReportRenderRequest", () => {
  it("accepts a valid request and a null-level result", () => {
    expect(ReportRenderRequestSchema.safeParse(VALID_REQUEST).success).toBe(true);
    expect(
      ReportRenderRequestSchema.safeParse({
        ...VALID_REQUEST,
        level: null,
        stop: false,
        routes: [],
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown locale, a bad module id, and unknown fields", () => {
    expect(ReportRenderRequestSchema.safeParse({ ...VALID_REQUEST, locale: "de" }).success).toBe(
      false,
    );
    expect(ReportRenderRequestSchema.safeParse({ ...VALID_REQUEST, routes: ["ZZZ"] }).success).toBe(
      false,
    );
    expect(ReportRenderRequestSchema.safeParse({ ...VALID_REQUEST, recompute: true }).success).toBe(
      false,
    );
  });
});

describe("ReportRef", () => {
  it("accepts null URLs (not yet stored) and populated URLs", () => {
    const base = {
      reportId: "r1",
      assessmentId: "a1",
      templateVersion: "report_v1",
      definitionVersion: "1.0",
      contentVersion: "1.1",
      locale: "es",
      createdAt: "2026-08-17T12:00:00Z",
      htmlUrl: null,
      pdfUrl: null,
    };
    expect(ReportRefSchema.safeParse(base).success).toBe(true);
    expect(
      ReportRefSchema.safeParse({ ...base, htmlUrl: "https://x/y", pdfUrl: "https://x/z" }).success,
    ).toBe(true);
  });
});
