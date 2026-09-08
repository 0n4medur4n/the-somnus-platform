import { describe, expect, it, vi } from "vitest";

const { get, post, patch, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock("./api.js", () => ({ api: { get, post, patch, del } }));

const { edge } = await import("./edge.js");

describe("edge (typed edge-api surface)", () => {
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
});
