import { describe, expect, it, vi } from "vitest";

const { get, post, patch, del, url } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  url: vi.fn((path: string) => `https://app.example${path}`),
}));
vi.mock("./api.js", () => ({ api: { get, post, patch, del, url } }));

const { edge } = await import("./edge.js");

describe("edge (typed edge-api surface)", () => {
  it("sends invitation lookup and acceptance through authenticated POSTs without identity claims", () => {
    const invitationId = "018f0000-0000-7000-8000-000000000001";
    void edge.platformInvitation(invitationId);
    expect(post).toHaveBeenCalledWith("/v1/platform-invitation/lookup", { invitationId });
    void edge.acceptPlatformInvitation({ invitationId });
    expect(post).toHaveBeenCalledWith("/v1/platform-invitation/accept", { invitationId });
  });
  it("sends every step of the v2 interview to /v1/funnel, asking for the team panel only when told", () => {
    void edge.getFunnelConfig();
    expect(get).toHaveBeenCalledWith("/v1/funnel/config");
    void edge.startFunnel(false);
    expect(post).toHaveBeenCalledWith("/v1/funnel/sessions", { consentGiven: true });
    void edge.startFunnel(true);
    expect(post).toHaveBeenCalledWith("/v1/funnel/sessions?panel=1", { consentGiven: true });
    void edge.getFunnel("f 1", true);
    expect(get).toHaveBeenCalledWith("/v1/funnel/sessions/f%201?panel=1");
    const body = { key: "Q01#confirmacion", decisions: [{ id: "Q03", decision: "confirmado" }] };
    void edge.answerFunnel("f-1", body as never, false);
    expect(post).toHaveBeenCalledWith("/v1/funnel/sessions/f-1/answers", body);
    void edge.backFunnel("f-1", false);
    expect(post).toHaveBeenCalledWith("/v1/funnel/sessions/f-1/back");
    void edge.rewindFunnel("f-1", "Q03", true);
    expect(post).toHaveBeenCalledWith("/v1/funnel/sessions/f-1/rewind?panel=1", { key: "Q03" });
    expect(edge.funnelReportUrl("f-1", "es")).toBe(
      "https://app.example/v1/funnel/sessions/f-1/report.pdf?locale=es",
    );
  });
  it("createSession posts the id token", () => {
    void edge.createSession("id-token");
    expect(post).toHaveBeenCalledWith("/v1/sessions", { idToken: "id-token" });
  });

  // One case per role branch: the client must forward the whole branch, not
  // a name-only subset (Addendum A Checkpoint 14.1).
  it("register posts the adult branch to /v1/registration unchanged", () => {
    const body = {
      role: "adult",
      firstName: "Ada",
      lastName: "L",
      gender: "female",
      country: "ES",
      dateOfBirth: "1990-05-17",
      ageYears: 34,
      consents: { termsAcceptance: true, privacyPolicyAcknowledgement: true },
    } as const;
    void edge.register(body);
    expect(post).toHaveBeenCalledWith("/v1/registration", body);
  });

  it("register posts the parent branch to /v1/registration unchanged", () => {
    const body = {
      role: "parent",
      firstName: "Marie",
      lastName: "C",
      gender: "female",
      country: "ES",
      dateOfBirth: "1990-05-17",
      guardianshipConfirmed: true,
      minorAgeBand: "6-12y",
      consents: { termsAcceptance: true, privacyPolicyAcknowledgement: true },
    } as const;
    void edge.register(body);
    expect(post).toHaveBeenCalledWith("/v1/registration", body);
  });

  it("register posts the professional branch to /v1/registration unchanged", () => {
    const body = {
      role: "professional",
      firstName: "Grace",
      lastName: "H",
      gender: "female",
      country: "ES",
      dateOfBirth: "1990-05-17",
      specialty: "sleep_physician",
      licenseNumber: "COL-12345",
      consents: { termsAcceptance: true, privacyPolicyAcknowledgement: true },
    } as const;
    void edge.register(body);
    expect(post).toHaveBeenCalledWith("/v1/registration", body);
  });

  it("patchProfile patches /v1/me/profile", () => {
    void edge.patchProfile({ firstName: "A" });
    expect(patch).toHaveBeenCalledWith("/v1/me/profile", { firstName: "A" });
  });

  it("createOrganization posts to /v1/organizations", () => {
    void edge.createOrganization({ name: "Acme" });
    expect(post).toHaveBeenCalledWith("/v1/organizations", { name: "Acme" });
  });

  it("listMembers gets the org members path", () => {
    void edge.listMembers("org-1");
    expect(get).toHaveBeenCalledWith("/v1/organizations/org-1/members");
  });

  it("invite posts to the org invitations path", () => {
    void edge.invite("org-1", { email: "i@example.com" });
    expect(post).toHaveBeenCalledWith("/v1/organizations/org-1/invitations", {
      email: "i@example.com",
    });
  });

  it("acceptInvitation posts the token", () => {
    void edge.acceptInvitation({ token: "tok" });
    expect(post).toHaveBeenCalledWith("/v1/invitations/accept", { token: "tok" });
  });

  it("getMe and logout hit the right paths", () => {
    void edge.getMe();
    expect(get).toHaveBeenCalledWith("/v1/me");
    void edge.logout();
    expect(del).toHaveBeenCalledWith("/v1/sessions/current");
  });
});

describe("edge (Morpheo anonymous assessment surface)", () => {
  it("getAssessmentContent gets the content path", () => {
    void edge.getAssessmentContent();
    expect(get).toHaveBeenCalledWith("/v1/assessments/content");
  });

  it("createAssessment posts the role + consent", () => {
    void edge.createAssessment({ role: "adult", consentGiven: true });
    expect(post).toHaveBeenCalledWith("/v1/assessments", { role: "adult", consentGiven: true });
  });

  it("submitAssessmentAnswer posts to the session answers path", () => {
    void edge.submitAssessmentAnswer("sess-1", { kind: "signal", name: "cyanosis", value: "true" });
    expect(post).toHaveBeenCalledWith("/v1/assessments/sess-1/answers", {
      kind: "signal",
      name: "cyanosis",
      value: "true",
    });
  });

  it("getAssessmentSummary gets the session summary path", () => {
    void edge.getAssessmentSummary("sess-1");
    expect(get).toHaveBeenCalledWith("/v1/assessments/sess-1/summary");
  });

  it("requestAssessmentClaimToken posts to the claim-token path", () => {
    void edge.requestAssessmentClaimToken("sess-1");
    expect(post).toHaveBeenCalledWith("/v1/assessments/sess-1/claim-token");
  });

  it("claimAssessment posts the token", () => {
    void edge.claimAssessment("tok");
    expect(post).toHaveBeenCalledWith("/v1/assessments/claim", { token: "tok" });
  });

  it("getAssessmentSnapshot gets the session snapshot path", () => {
    void edge.getAssessmentSnapshot("sess-1");
    expect(get).toHaveBeenCalledWith("/v1/assessments/sess-1/snapshot");
  });

  it("links the report download to the person's own assessment, in their language", () => {
    expect(edge.assessmentReportUrl("sess/1", "ca")).toBe(
      "https://app.example/v1/reports/assessments/sess%2F1/pdf?locale=ca",
    );
    expect(edge.photoUrl("2026-10-16T10:00:00.000Z")).toBe(
      "https://app.example/v1/me/photo?v=2026-10-16T10%3A00%3A00.000Z",
    );
  });
});
