import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FunnelAnswerRequestSchema,
  FunnelCreateRequestSchema,
  FunnelStateSchema,
} from "./funnel.js";
import { FREE_TEXT_MAX_LENGTH, findIdentifyingData } from "./identifying-data.js";

const CASES = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../schemas/fixtures/identifying-data.json",
    ),
    "utf8",
  ),
) as { blocked: { text: string; kinds: string[] }[]; allowed: string[] };

describe("the free-text identifying-data filter (shared cases with morpheo)", () => {
  it.each(CASES.blocked)("blocks $text", ({ text, kinds }) => {
    expect(findIdentifyingData(text)).toEqual(kinds);
  });

  it.each(CASES.allowed)("lets through %s", (text) => {
    expect(findIdentifyingData(text)).toEqual([]);
  });
});

describe("FunnelAnswerRequest", () => {
  it("takes a value or an absence, never both or neither", () => {
    expect(
      FunnelAnswerRequestSchema.safeParse({ key: "Q03", value: { value: 6, unit: "meses" } })
        .success,
    ).toBe(true);
    expect(FunnelAnswerRequestSchema.safeParse({ key: "Q03", absence: "no_lo_se" }).success).toBe(
      true,
    );
    expect(
      FunnelAnswerRequestSchema.safeParse({ key: "Q03", value: 4, absence: "no_lo_se" }).success,
    ).toBe(false);
    expect(FunnelAnswerRequestSchema.safeParse({ key: "Q03" }).success).toBe(false);
  });

  it("accepts every answer shape the engine asks for", () => {
    for (const value of [45, "si", ["dormirse", "despertares"], [], { acostarse: "23:30" }]) {
      expect(FunnelAnswerRequestSchema.safeParse({ key: "k", value }).success).toBe(true);
    }
  });

  it("refuses free text or a note with an email, a phone or a DNI", () => {
    for (const text of ["escríbeme a ana@example.com", "mi móvil 612 345 678", "DNI 12345678 Z"]) {
      expect(FunnelAnswerRequestSchema.safeParse({ key: "Q01", value: text }).success).toBe(false);
      expect(FunnelAnswerRequestSchema.safeParse({ key: "Q04", value: "si", text }).success).toBe(
        false,
      );
    }
  });

  it("caps free text", () => {
    const long = "a".repeat(FREE_TEXT_MAX_LENGTH + 1);
    expect(FunnelAnswerRequestSchema.safeParse({ key: "Q01", value: long }).success).toBe(false);
  });

  it("refuses unknown fields", () => {
    expect(
      FunnelAnswerRequestSchema.safeParse({ key: "Q05", value: 4, order: "Q06" }).success,
    ).toBe(false);
  });
});

describe("FunnelCreateRequest", () => {
  it("needs the health-data consent", () => {
    expect(FunnelCreateRequestSchema.safeParse({ consentGiven: true }).success).toBe(true);
    expect(FunnelCreateRequestSchema.safeParse({ consentGiven: false }).success).toBe(false);
  });
});

describe("FunnelState", () => {
  it("carries a step, or a result once the engine has finished", () => {
    const state = {
      sessionId: "s1",
      status: "finished",
      step: null,
      result: {
        stoppedBy: null,
        alerts: [],
        mainAction: "TERAPIA",
        associatedActions: [],
        testToConsider: null,
        texts: [{ template: "T_INSOMNIO", text: "Nos ha contado que…" }],
        instruments: [],
        instrumentsNote: null,
        contentVersion: "2.0",
        rulesVersion: "2.0",
        panel: null,
      },
      history: [{ key: "AGE", question: "¿Qué edad tiene?", answer: "52 años" }],
      owned: false,
    };
    expect(FunnelStateSchema.safeParse(state).success).toBe(true);
  });
});
