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

  it("accepts both flags literal true", () => {
    expect(isExplicitNoxGrant({ verifiedProfessional: true, noxAccess: true })).toBe(true);
  });

  it("ignores unknown fields when every grant field is literal true", () => {
    expect(
      isExplicitNoxGrant({
        verifiedProfessional: true,
        noxAccess: true,
        role: "professional",
      }),
    ).toBe(true);
    expect(isExplicitNoxGrant({ verifiedProfessional: true, noxAccess: true, extra: 1 })).toBe(
      true,
    );
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
    { verifiedProfessional: true, noxAccess: "unknown" },
  ])("denies %j", (body) => {
    expect(isExplicitNoxGrant(body)).toBe(false);
  });
});
