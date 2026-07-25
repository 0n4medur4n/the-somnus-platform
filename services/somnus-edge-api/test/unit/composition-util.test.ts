import { SomnusError } from "@somnus/errors";
import { describe, expect, it } from "vitest";
import { correlationOf, requireSession } from "../../src/common/composition.util.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";

const SESSION = { sessionId: "s1", firebaseUid: "f1" } as unknown as SessionRecord;

describe("composition.util", () => {
  it("requireSession returns the session when present", () => {
    expect(requireSession(SESSION, "corr")).toBe(SESSION);
  });

  it("requireSession throws UNAUTHENTICATED when the session is missing", () => {
    expect(() => requireSession(undefined, "corr")).toThrow(SomnusError);
    try {
      requireSession(undefined, "corr");
    } catch (err) {
      expect((err as SomnusError).code).toBe("UNAUTHENTICATED");
    }
  });

  it("correlationOf passes through a present id", () => {
    expect(correlationOf("abc")).toBe("abc");
  });

  it("correlationOf generates a fallback when none is present", () => {
    const generated = correlationOf(undefined);
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  });
});
