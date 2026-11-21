import { describe, expect, it } from "vitest";
import { EMAIL_LINK_AMR } from "../../src/modules/sessions/classify-session.js";
import {
  amrFromVerifiedToken,
  authTimeFromClaim,
} from "../../src/modules/sessions/verified-sign-in.js";

describe("authTimeFromClaim", () => {
  it("converts a finite number of seconds into a Date", () => {
    expect(authTimeFromClaim(1_600_000_000)?.toISOString()).toBe("2020-09-13T12:26:40.000Z");
  });

  it.each([undefined, null, "1600000000", Number.NaN, Number.POSITIVE_INFINITY, true, 1e20])(
    "refuses %j",
    (claim) => {
      expect(authTimeFromClaim(claim)).toBeNull();
    },
  );
});

describe("amrFromVerifiedToken", () => {
  it("records email_link for the password provider, which does not name an email link", () => {
    // Identity Platform enables email with password_required false and phone
    // off, and both clients only call signInWithEmailLink. Firebase still
    // puts "password" on that token, the same value as a password sign-in.
    expect(amrFromVerifiedToken("password")).toEqual([EMAIL_LINK_AMR]);
    expect(amrFromVerifiedToken(undefined)).toEqual([EMAIL_LINK_AMR]);
  });

  it("records a provider string when the token names a method other than password", () => {
    expect(amrFromVerifiedToken("google.com")).toEqual(["google.com"]);
  });
});
