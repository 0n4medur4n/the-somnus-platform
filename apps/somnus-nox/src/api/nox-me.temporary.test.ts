import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isExplicitNoxGrant } from "./nox-me.temporary.js";

const source = readFileSync(join(process.cwd(), "src/api/nox-me.temporary.ts"), "utf8");

describe("explicit Nox grant", () => {
  it("is marked temporary until api-contracts owns the route", () => {
    expect(source).toContain("TEMPORARY");
    expect(source).toContain("packages/api-contracts");
  });

  it("accepts only both flags literal true and nothing else", () => {
    expect(isExplicitNoxGrant({ verifiedProfessional: true, noxAccess: true })).toBe(true);
  });

  it.each([
    { verifiedProfessional: false, noxAccess: false },
    { verifiedProfessional: false, noxAccess: true },
    { verifiedProfessional: true, noxAccess: false },
    { verifiedProfessional: true },
    { noxAccess: true },
    {},
    null,
    "granted",
    { verifiedProfessional: "true", noxAccess: true },
    { verifiedProfessional: true, noxAccess: true, role: "professional" },
  ])("denies %j", (body) => {
    expect(isExplicitNoxGrant(body)).toBe(false);
  });
});
