import { describe, expect, it } from "vitest";
import { isCsrfExempt } from "../../src/bootstrap/harden.js";

/**
 * Which state-changing routes skip the CSRF gate. Each exemption is a route
 * with no session cookie to forge against; everything else must be protected.
 */
describe("CSRF exemptions", () => {
  it("exempts the anonymous v2 interview: start, answer, back and rewind", () => {
    for (const path of [
      "/v1/funnel/sessions",
      "/v1/funnel/sessions/3f1c2a/answers",
      "/v1/funnel/sessions/3f1c2a/back",
      "/v1/funnel/sessions/3f1c2a/rewind",
    ]) {
      expect(isCsrfExempt(path), path).toBe(true);
    }
  });

  it("exempts nothing else under /v1/funnel", () => {
    for (const path of [
      "/v1/funnel",
      "/v1/funnel/config",
      "/v1/funnel/sessions/3f1c2a",
      "/v1/funnel/sessions/3f1c2a/report.pdf",
      "/v1/funnel/sessions/3f1c2a/answers/extra",
      "/v1/funnel/sessions//answers",
      "/v1/funnel/sessions/a/b/answers",
      "/v1/funnelx/sessions",
    ]) {
      expect(isCsrfExempt(path), path).toBe(false);
    }
  });

  it("keeps the routes that ride the session protected", () => {
    for (const path of [
      "/v1/assessments/claim",
      "/v1/invitations/accept",
      "/v1/me",
      "/v1/consents",
    ]) {
      expect(isCsrfExempt(path), path).toBe(false);
    }
  });

  it("still exempts the login bootstrap and the anonymous assessment routes", () => {
    for (const path of [
      "/v1/sessions",
      "/v1/auth/email-link",
      "/v1/assessments",
      "/v1/assessments/x/answers",
    ]) {
      expect(isCsrfExempt(path), path).toBe(true);
    }
  });
});
