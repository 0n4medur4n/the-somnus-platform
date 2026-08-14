import type {
  AnswerSubmitRequest,
  AssessmentClaimResponse,
  AssessmentClaimTokenResponse,
  AssessmentContentResponse,
  AssessmentCreateRequest,
  AssessmentCreateResponse,
  AssessmentResult,
  AssessmentSnapshotResponse,
  Invitation,
  InvitationAcceptRequest,
  InvitationCreateRequest,
  InvitationCreateResponse,
  Membership,
  MeResponse,
  Organization,
  OrganizationCreateRequest,
  ProfilePatchRequest,
  RegistrationRequest,
  SessionResponse,
} from "@somnus/api-contracts";
import { api } from "./api.js";

/**
 * Typed edge-api surface (the only backend the SPA talks to, build plan
 * §5.2). Request/response types come from `@somnus/api-contracts`, so
 * the contract is the single source of truth on both sides.
 */
export const edge = {
  createSession: (idToken: string): Promise<SessionResponse> =>
    api.post<SessionResponse>("/v1/sessions", { idToken }),
  getMe: (): Promise<MeResponse> => api.get<MeResponse>("/v1/me"),
  register: (body: RegistrationRequest): Promise<MeResponse> =>
    api.post<MeResponse>("/v1/registration", body),
  patchProfile: (body: ProfilePatchRequest): Promise<void> =>
    api.patch<void>("/v1/me/profile", body),
  logout: (): Promise<void> => api.del<void>("/v1/sessions/current"),
  createOrganization: (body: OrganizationCreateRequest): Promise<Organization> =>
    api.post<Organization>("/v1/organizations", body),
  listMembers: (organizationId: string): Promise<Membership[]> =>
    api.get<Membership[]>(`/v1/organizations/${organizationId}/members`),
  invite: (
    organizationId: string,
    body: InvitationCreateRequest,
  ): Promise<InvitationCreateResponse> =>
    api.post<InvitationCreateResponse>(`/v1/organizations/${organizationId}/invitations`, body),
  acceptInvitation: (body: InvitationAcceptRequest): Promise<Invitation> =>
    api.post<Invitation>("/v1/invitations/accept", body),

  // --- Morpheo anonymous assessment (build plan §20 Checkpoint 10.3) ---
  getAssessmentContent: (): Promise<AssessmentContentResponse> =>
    api.get<AssessmentContentResponse>("/v1/assessments/content"),
  createAssessment: (body: AssessmentCreateRequest): Promise<AssessmentCreateResponse> =>
    api.post<AssessmentCreateResponse>("/v1/assessments", body),
  submitAssessmentAnswer: (
    sessionId: string,
    body: AnswerSubmitRequest,
  ): Promise<AssessmentResult> =>
    api.post<AssessmentResult>(`/v1/assessments/${sessionId}/answers`, body),
  getAssessmentSummary: (sessionId: string): Promise<AssessmentResult> =>
    api.get<AssessmentResult>(`/v1/assessments/${sessionId}/summary`),
  requestAssessmentClaimToken: (sessionId: string): Promise<AssessmentClaimTokenResponse> =>
    api.post<AssessmentClaimTokenResponse>(`/v1/assessments/${sessionId}/claim-token`),
  claimAssessment: (token: string): Promise<AssessmentClaimResponse> =>
    api.post<AssessmentClaimResponse>("/v1/assessments/claim", { token }),
  getAssessmentSnapshot: (sessionId: string): Promise<AssessmentSnapshotResponse> =>
    api.get<AssessmentSnapshotResponse>(`/v1/assessments/${sessionId}/snapshot`),
};
