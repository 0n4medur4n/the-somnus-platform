/**
 * The edge <-> morpheo contract (build plan §20 Checkpoint 10.2). Two claims:
 *
 * 1. The Zod schemas accept what they should and reject what they should
 *    (missing required fields, unknown fields under `.strict()`, bad enums) —
 *    the runtime validator the edge will apply to every morpheo call.
 * 2. The checked-in JSON Schema artifacts under schemas/json-schema/morpheo/
 *    still equal what `z.toJSONSchema` produces now. Those files are what the
 *    Python provider validates against, so a Zod change that is not
 *    regenerated (or a hand-edited file) fails CI here — the drift guard that
 *    keeps both sides of a cross-language boundary honest.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AnswerSubmitRequestSchema,
  AssessmentClaimRequestSchema,
  AssessmentClaimResponseSchema,
  AssessmentClaimTokenResponseSchema,
  AssessmentCreateRequestSchema,
  AssessmentCreateResponseSchema,
  AssessmentResultSchema,
  AssessmentSnapshotResponseSchema,
  MORPHEO_CONTRACT_SCHEMAS,
} from "./assessment.js";
import { AssessmentContentResponseSchema } from "./content.js";
import { MORPHEO_MODULES, MORPHEO_ROLES, MORPHEO_SAFETY_LEVELS } from "./enums.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "schemas",
  "json-schema",
  "morpheo",
);

describe("generated JSON Schema artifacts stay in sync with the Zod source", () => {
  for (const [name, schema] of Object.entries(MORPHEO_CONTRACT_SCHEMAS)) {
    it(`${name}.json equals z.toJSONSchema(${name})`, () => {
      const onDisk = JSON.parse(readFileSync(resolve(ARTIFACT_DIR, `${name}.json`), "utf8"));
      expect(onDisk).toEqual(z.toJSONSchema(schema));
    });
  }
});

describe("AssessmentCreateRequest", () => {
  it("accepts a minimal valid adult request", () => {
    expect(
      AssessmentCreateRequestSchema.safeParse({ role: "adult", consentGiven: true }).success,
    ).toBe(true);
  });

  it("accepts optional demographic + orientation fields", () => {
    const parsed = AssessmentCreateRequestSchema.safeParse({
      role: "parent",
      consentGiven: true,
      ageYears: 8,
      guardianshipConfirmed: true,
      baseOrientation: "L2",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an urgent base orientation (L0/L1 only come from a fired rule)", () => {
    expect(
      AssessmentCreateRequestSchema.safeParse({
        role: "adult",
        consentGiven: true,
        baseOrientation: "L1",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown role, a missing consent flag, and unknown fields", () => {
    expect(
      AssessmentCreateRequestSchema.safeParse({ role: "wizard", consentGiven: true }).success,
    ).toBe(false);
    expect(AssessmentCreateRequestSchema.safeParse({ role: "adult" }).success).toBe(false);
    expect(
      AssessmentCreateRequestSchema.safeParse({ role: "adult", consentGiven: true, name: "Ada" })
        .success,
    ).toBe(false);
  });
});

describe("AnswerSubmitRequest", () => {
  it("accepts a complaint and a three-valued signal", () => {
    expect(
      AnswerSubmitRequestSchema.safeParse({ kind: "complaint", name: "ronquido" }).success,
    ).toBe(true);
    expect(
      AnswerSubmitRequestSchema.safeParse({
        kind: "signal",
        name: "witnessed_apneas",
        value: "unknown",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown kind and an out-of-range ternary value", () => {
    expect(AnswerSubmitRequestSchema.safeParse({ kind: "guess", name: "x" }).success).toBe(false);
    expect(
      AnswerSubmitRequestSchema.safeParse({ kind: "signal", name: "x", value: "maybe" }).success,
    ).toBe(false);
  });
});

describe("AssessmentResult", () => {
  const valid = {
    role: "adult",
    level: "L1",
    stop: true,
    privacyBlock: false,
    routes: ["SLP"],
    triggeredRules: ["SAFE-003"],
    workflowVersion: "1.0",
    contentVersion: "1.0",
  };

  it("accepts a fired-safety result and a null-level blocked result", () => {
    expect(AssessmentResultSchema.safeParse(valid).success).toBe(true);
    expect(
      AssessmentResultSchema.safeParse({ ...valid, level: null, stop: false, routes: [] }).success,
    ).toBe(true);
  });

  it("rejects a missing level (must be present, even if null) and a bad module id", () => {
    const { level: _level, ...withoutLevel } = valid;
    expect(AssessmentResultSchema.safeParse(withoutLevel).success).toBe(false);
    expect(AssessmentResultSchema.safeParse({ ...valid, routes: ["ZZZ"] }).success).toBe(false);
  });
});

describe("claim + snapshot responses", () => {
  it("accept success and rejection shapes", () => {
    expect(AssessmentClaimRequestSchema.safeParse({ token: "abc123" }).success).toBe(true);
    expect(
      AssessmentClaimResponseSchema.safeParse({ success: true, snapshotId: "snap-1", reason: null })
        .success,
    ).toBe(true);
    expect(
      AssessmentClaimResponseSchema.safeParse({
        success: false,
        snapshotId: null,
        reason: "already_claimed_or_expired",
      }).success,
    ).toBe(true);
    expect(
      AssessmentCreateResponseSchema.safeParse({
        allowed: false,
        sessionId: null,
        reason: "consent_required",
      }).success,
    ).toBe(true);
    expect(
      AssessmentSnapshotResponseSchema.safeParse({
        snapshotId: "snap-1",
        sessionId: "sess-1",
        result: {
          role: "parent",
          level: "L2",
          stop: false,
          privacyBlock: false,
          routes: ["BRE"],
          triggeredRules: ["SAFE-008"],
          workflowVersion: "1.0",
          contentVersion: "1.0",
        },
        workflowVersion: "1.0",
        contentVersion: "1.0",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown claim rejection reason", () => {
    expect(
      AssessmentClaimResponseSchema.safeParse({ success: false, snapshotId: null, reason: "nope" })
        .success,
    ).toBe(false);
  });

  it("accepts a minted claim token and rejects an over-long one", () => {
    expect(AssessmentClaimTokenResponseSchema.safeParse({ token: "a".repeat(32) }).success).toBe(
      true,
    );
    expect(AssessmentClaimTokenResponseSchema.safeParse({ token: "a".repeat(65) }).success).toBe(
      false,
    );
  });
});

describe("AssessmentContentResponse", () => {
  const valid = {
    locale: "es",
    workflowVersion: "1.0",
    contentVersion: "1.0",
    modules: [
      {
        id: "INS",
        name: "Dificultad para dormir",
        entry: ["despertares"],
        minimumQuestions: ["¿Desde cuándo?"],
        output: "…",
      },
    ],
    safetyLevels: [{ id: "L0", name: "Emergencia actual", action: "Atención de emergencia." }],
    outputContract: {
      patientParent: ["Resumen."],
      professional: ["Resumen."],
      forbiddenPhrases: ["Tienes [x]."],
    },
  };

  it("accepts artifact-shaped content and rejects an unknown locale / bad module id", () => {
    expect(AssessmentContentResponseSchema.safeParse(valid).success).toBe(true);
    expect(AssessmentContentResponseSchema.safeParse({ ...valid, locale: "de" }).success).toBe(
      false,
    );
    expect(
      AssessmentContentResponseSchema.safeParse({
        ...valid,
        modules: [{ ...valid.modules[0], id: "ZZZ" }],
      }).success,
    ).toBe(false);
  });
});

describe("contract enums are the closed vocabularies the engine uses", () => {
  it("expose exactly the clinical roles, levels, and modules", () => {
    expect(MORPHEO_ROLES).toEqual(["adult", "parent", "professional"]);
    expect(MORPHEO_SAFETY_LEVELS).toEqual(["L0", "L1", "L2", "L3", "L4"]);
    expect(MORPHEO_MODULES).toEqual(["INS", "BRE", "SLP", "CIR", "RLS", "PAR"]);
  });
});
