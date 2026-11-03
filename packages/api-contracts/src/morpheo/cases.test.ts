import { describe, expect, it } from "vitest";
import {
  BREAK_GLASS_CATEGORIES,
  BREAK_GLASS_JUSTIFICATION_MAX_LENGTH,
  BREAK_GLASS_JUSTIFICATION_MIN_LENGTH,
} from "../identity/break-glass.js";
import {
  FUNNEL_CASE_ACCESS_CATEGORIES,
  FUNNEL_CASE_CODE_PATTERN,
  FUNNEL_CASE_JUSTIFICATION_MAX_LENGTH,
  FUNNEL_CASE_JUSTIFICATION_MIN_LENGTH,
  FunnelCaseOpenRequestSchema,
  FunnelCaseStatsSchema,
} from "./cases.js";

const WHY = "Reclamación formal recibida, expediente 12.";

describe("opening a case (ADR 0024)", () => {
  it("is justified exactly like break-glass", () => {
    expect(FUNNEL_CASE_ACCESS_CATEGORIES).toEqual(BREAK_GLASS_CATEGORIES);
    expect(FUNNEL_CASE_JUSTIFICATION_MIN_LENGTH).toBe(BREAK_GLASS_JUSTIFICATION_MIN_LENGTH);
    expect(FUNNEL_CASE_JUSTIFICATION_MAX_LENGTH).toBe(BREAK_GLASS_JUSTIFICATION_MAX_LENGTH);
  });

  it("needs a category and a real justification, and nothing else", () => {
    const ok = { caseCode: "SOM-7K3F-Q9XA", category: "legal", justification: WHY };
    expect(FunnelCaseOpenRequestSchema.safeParse(ok).success).toBe(true);
    expect(
      FunnelCaseOpenRequestSchema.safeParse({ ...ok, justification: " ".repeat(30) }).success,
    ).toBe(false);
    expect(FunnelCaseOpenRequestSchema.safeParse({ ...ok, category: "curiosity" }).success).toBe(
      false,
    );
    expect(FunnelCaseOpenRequestSchema.safeParse({ ...ok, unlock: true }).success).toBe(false);
    const { justification: _omitted, ...withoutWhy } = ok;
    expect(FunnelCaseOpenRequestSchema.safeParse(withoutWhy).success).toBe(false);
  });

  it("codes use Crockford's alphabet", () => {
    expect(FUNNEL_CASE_CODE_PATTERN.test("SOM-7K3F-Q9XA")).toBe(true);
    for (const code of ["SOM-7K3F-Q9XU", "SOM-7K3F-Q9XI", "som-7k3f-q9xa", "SOM-7K3FQ9XA"]) {
      expect(FUNNEL_CASE_CODE_PATTERN.test(code)).toBe(false);
    }
  });
});

describe("case statistics", () => {
  it("are counts only: a case code or a session id has nowhere to go", () => {
    const empty = {
      started: 0,
      byStatus: { open: 0, finished: 0, stopped: 0, paused: 0 },
      closed: 0,
      byMainAction: [],
      byTemplate: [],
      byAlert: [],
      withAlerts: 0,
      byMonth: [],
      firstStartedAt: null,
      lastStartedAt: null,
    };
    expect(FunnelCaseStatsSchema.safeParse(empty).success).toBe(true);
    expect(
      FunnelCaseStatsSchema.safeParse({ ...empty, caseCodes: ["SOM-7K3F-Q9XA"] }).success,
    ).toBe(false);
  });
});
