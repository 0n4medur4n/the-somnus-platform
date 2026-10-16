import type {
  AnswerSubmitRequest,
  AssessmentClaimResponse,
  AssessmentClaimTokenResponse,
  AssessmentContentResponse,
  AssessmentCreateRequest,
  AssessmentCreateResponse,
  AssessmentResult,
  AssessmentSnapshotResponse,
  ConsentPurposeKey,
  ConsentReceipt,
  ConsentRecordsResponse,
  ConsentStatusListResponse,
  CurrentLegalDocumentsResponse,
  Invitation,
  InvitationAcceptRequest,
  InvitationCreateRequest,
  InvitationCreateResponse,
  InvitationPreviewRequest,
  InvitationPreviewResponse,
  Membership,
  MeResponse,
  Organization,
  OrganizationCreateRequest,
  OwnAssessmentsResponse,
  PersonReportResponse,
  ProfilePatchRequest,
  RegistrationRequest,
  SessionResponse,
  SignInLinkRequest,
  SupportedLocale,
} from "@somnus/api-contracts";
import { api, BinaryBody } from "./api.js";

/**
 * Typed edge-api surface (the only backend the SPA talks to, build plan
 * §5.2). Request/response types come from `@somnus/api-contracts`, so
 * the contract is the single source of truth on both sides.
 */
export const edge = {
  createSession: (idToken: string): Promise<SessionResponse> =>
    api.post<SessionResponse>("/v1/sessions", { idToken }),
  getMe: (): Promise<MeResponse> => api.get<MeResponse>("/v1/me"),
  /** Pre-login: The Somnus emails the sign-in link from its own domain. */
  requestSignInLink: (body: SignInLinkRequest): Promise<void> =>
    api.post<void>("/v1/auth/email-link", body),
  register: (body: RegistrationRequest): Promise<MeResponse> =>
    api.post<MeResponse>("/v1/registration", body),
  patchProfile: (body: ProfilePatchRequest): Promise<void> =>
    api.patch<void>("/v1/me/profile", body),
  /** A re-encoded image (see lib/photo.ts): image/webp or image/jpeg, at most 1 MB. */
  uploadPhoto: (image: Blob): Promise<void> =>
    api.put<void>("/v1/me/photo", new BinaryBody(image, image.type)),
  removePhoto: (): Promise<void> => api.del<void>("/v1/me/photo"),
  /** The photo URL; `version` (the photo's change time) keeps a new photo from showing stale. */
  photoUrl: (version: string): string => api.url(`/v1/me/photo?v=${encodeURIComponent(version)}`),
  /** The person's AI-written report for an assessment (written once, then stored). */
  getPersonReport: (sessionId: string, locale: SupportedLocale): Promise<PersonReportResponse> =>
    api.get<PersonReportResponse>(
      `/v1/assessments/${encodeURIComponent(sessionId)}/report?locale=${encodeURIComponent(locale)}`,
    ),
  /** The PDF report for one of the person's saved assessments (a download link). */
  assessmentReportUrl: (sessionId: string, locale: SupportedLocale): string =>
    api.url(
      `/v1/reports/assessments/${encodeURIComponent(sessionId)}/pdf?locale=${encodeURIComponent(locale)}`,
    ),
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
  /** Pre-login: the only invitation call that works without a session (Addendum A 14.2). */
  previewInvitation: (body: InvitationPreviewRequest): Promise<InvitationPreviewResponse> =>
    api.post<InvitationPreviewResponse>("/v1/invitations/preview", body),

  // --- Consent (build plan §13) ---
  /**
   * The current legal documents in `locale`. A receipt binds to the text in
   * the language it is signed in, so what is shown is what is signed.
   */
  getLegalDocuments: (locale: SupportedLocale): Promise<CurrentLegalDocumentsResponse> =>
    api.get<CurrentLegalDocumentsResponse>(
      `/v1/legal-documents/current?locale=${encodeURIComponent(locale)}`,
    ),
  getConsentStatus: (): Promise<ConsentStatusListResponse> =>
    api.get<ConsentStatusListResponse>("/v1/consents/current"),
  getConsentRecords: (): Promise<ConsentRecordsResponse> =>
    api.get<ConsentRecordsResponse>("/v1/consents/receipts"),
  recordConsent: (
    purposeKey: ConsentPurposeKey,
    source: string,
    locale: SupportedLocale,
  ): Promise<ConsentReceipt> =>
    api.post<ConsentReceipt>("/v1/consents", { purposeKey, source, locale }),
  withdrawConsent: (receiptId: string): Promise<void> =>
    api.post<void>(`/v1/consents/${encodeURIComponent(receiptId)}/withdraw`, {}),

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
    api.get<AssessmentSnapshotResponse>(
      `/v1/assessments/${encodeURIComponent(sessionId)}/snapshot`,
    ),
  /** The signed-in person's own saved assessments, newest first. */
  getOwnAssessments: (): Promise<OwnAssessmentsResponse> =>
    api.get<OwnAssessmentsResponse>("/v1/assessments/mine"),
};
