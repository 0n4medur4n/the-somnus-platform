import type {
  AdminAccountStatusRequest,
  AdminDeletionDecisionRequest,
  AdminDeletionRequest,
  AdminMeResponse,
  AdminOrganizationCreateRequest,
  AdminOrganizationMember,
  AdminOrganizationStatusRequest,
  AdminOrganizationSummary,
  AdminRoleAssignRequest,
  AdminRoleAssignResponse,
  AdminUserDetail,
  AdminUserSearchRequest,
  AdminUserSearchResponse,
  AdminUsersOverview,
  AdminVerificationCase,
  AdminVerificationDecisionRequest,
  AuditQueryRequest,
  AuditViewPage,
  BreakGlassRevealRequest,
  BreakGlassRevealResponse,
  ContentReviewDecisionRequest,
  ContentReviewItem,
  ContentReviewQueue,
  CorpusDocument,
  CorpusDocumentCreateRequest,
  CorpusDocumentDetail,
  CorpusDocumentEditRequest,
  CorpusDocumentPage,
  CorpusPublishRequest,
  CorpusRetireRequest,
  CorpusSearchRequest,
  CorpusVersionResult,
  CorpusWebPageRequest,
  Dashboards,
  DriveAccount,
  DriveBlock,
  DriveDirectory,
  DriveEnrollRequest,
  DriveFolderCreateRequest,
  DriveKeyGenerationResult,
  DriveMember,
  DriveMemberAddRequest,
  DriveMemberKeyAcceptRequest,
  DriveMemberRemoveRequest,
  DriveMoveRequest,
  DriveNode,
  DrivePurgeResult,
  DriveRenameRequest,
  DriveRewrapRequest,
  DriveRole,
  DriveShareCreateRequest,
  DriveShareDetail,
  DriveShareList,
  DriveShareSummary,
  DriveStateRequest,
  DriveUploadStartRequest,
  DriveUploadStartResponse,
  PlatformInvitationCreateRequest,
  PlatformInvitationCreateResponse,
  PlatformInvitationListResponse,
  SessionResponse,
  SignInLinkRequest,
  SrcEnrichmentPage,
  StaffInvitation,
  StaffInvitationCreateRequest,
  StaffInvitationCreateResponse,
  StaffInvitationListResponse,
  StaffInvitationPendingResponse,
} from "@somnus/api-contracts";
import { api, type DownloadedFile } from "./api.js";
import { RawUpload } from "./raw-upload.js";

/**
 * The console's entire backend surface (Addendum A §A2.1): the shared session
 * exchange, the invited person's own staff invitation, and `/admin/v1/*`. It never calls a consumer route -- the console
 * has no business composing `/v1/me` or reading anyone's profile, and keeping
 * that out of this file makes the boundary visible rather than a convention.
 *
 * Nothing here is capability-aware. The server decides; a call the acting admin
 * may not make comes back 403, and the console simply never renders the control
 * that would have made it.
 */
export const edge = {
  platformInvitations: (): Promise<PlatformInvitationListResponse> =>
    api.get<PlatformInvitationListResponse>("/admin/v1/platform-invitations"),
  invitePlatformUser: (
    body: PlatformInvitationCreateRequest,
  ): Promise<PlatformInvitationCreateResponse> =>
    api.post<PlatformInvitationCreateResponse>("/admin/v1/platform-invitations", body),
  revokePlatformInvitation: (id: string): Promise<void> =>
    api.post<void>(`/admin/v1/platform-invitations/${encodeURIComponent(id)}/revoke`, {}),
  createSession: (idToken: string): Promise<SessionResponse> =>
    api.post<SessionResponse>("/v1/sessions", { idToken }),
  adminMe: (): Promise<AdminMeResponse> => api.get<AdminMeResponse>("/admin/v1/me"),
  logout: (): Promise<void> => api.del<void>("/v1/sessions/current"),
  /** Pre-login: The Somnus emails the sign-in link from its own domain. */
  requestSignInLink: (body: SignInLinkRequest): Promise<void> =>
    api.post<void>("/v1/auth/email-link", body),

  // --- Users (admin_users_read / admin_account_status_write) ---
  searchUsers: (body: AdminUserSearchRequest): Promise<AdminUserSearchResponse> =>
    api.post<AdminUserSearchResponse>("/admin/v1/users/search", body),
  /** Dashboard figures about accounts: counts only. */
  usersOverview: (): Promise<AdminUsersOverview> =>
    api.get<AdminUsersOverview>("/admin/v1/users/overview"),
  userDetail: (userId: string): Promise<AdminUserDetail> =>
    api.get<AdminUserDetail>(`/admin/v1/users/${encodeURIComponent(userId)}`),
  setUserStatus: (userId: string, body: AdminAccountStatusRequest): Promise<void> =>
    api.patch<void>(`/admin/v1/users/${encodeURIComponent(userId)}/status`, body),

  // --- Staff invitations (admin_roles_assign; owner decision 2026-10-18) ---
  staffInvitations: (): Promise<StaffInvitationListResponse> =>
    api.get<StaffInvitationListResponse>("/admin/v1/staff-invitations"),
  /** Also how the console resends: a new invitation replaces the pending one. */
  inviteStaff: (body: StaffInvitationCreateRequest): Promise<StaffInvitationCreateResponse> =>
    api.post<StaffInvitationCreateResponse>("/admin/v1/staff-invitations", body),
  revokeStaffInvitation: (invitationId: string): Promise<StaffInvitation> =>
    api.post<StaffInvitation>(
      `/admin/v1/staff-invitations/${encodeURIComponent(invitationId)}/revoke`,
      {},
    ),
  /**
   * The signed-in person's OWN invitation, before they hold any role: looked up
   * by the address the session verified, so it reads nobody else's data.
   */
  myStaffInvitation: (): Promise<StaffInvitationPendingResponse> =>
    api.get<StaffInvitationPendingResponse>("/v1/staff-invitation"),
  acceptStaffInvitation: (): Promise<void> =>
    api.post<void>("/v1/staff-invitation/accept", { privacyPolicyAcknowledged: true }),

  // --- Deletion requests (admin_deletion_requests_process) ---
  deletionRequests: (): Promise<AdminDeletionRequest[]> =>
    api.get<AdminDeletionRequest[]>("/admin/v1/deletion-requests"),
  decideDeletion: (requestId: string, body: AdminDeletionDecisionRequest): Promise<void> =>
    api.post<void>(`/admin/v1/deletion-requests/${encodeURIComponent(requestId)}/decision`, body),

  // --- Organizations (admin_organizations_manage) ---
  organizations: (): Promise<AdminOrganizationSummary[]> =>
    api.get<AdminOrganizationSummary[]>("/admin/v1/organizations"),
  createOrganization: (body: AdminOrganizationCreateRequest): Promise<AdminOrganizationSummary> =>
    api.post<AdminOrganizationSummary>("/admin/v1/organizations", body),
  setOrganizationStatus: (
    organizationId: string,
    body: AdminOrganizationStatusRequest,
  ): Promise<AdminOrganizationSummary> =>
    api.patch<AdminOrganizationSummary>(
      `/admin/v1/organizations/${encodeURIComponent(organizationId)}/status`,
      body,
    ),
  organizationMembers: (organizationId: string): Promise<AdminOrganizationMember[]> =>
    api.get<AdminOrganizationMember[]>(
      `/admin/v1/organizations/${encodeURIComponent(organizationId)}/members`,
    ),

  // --- Professional verification queue (admin_verification_queue) ---
  verificationQueue: (): Promise<AdminVerificationCase[]> =>
    api.get<AdminVerificationCase[]>("/admin/v1/verification-cases"),
  decideVerification: (
    caseId: string,
    body: AdminVerificationDecisionRequest,
  ): Promise<AdminVerificationCase> =>
    api.post<AdminVerificationCase>(
      `/admin/v1/verification-cases/${encodeURIComponent(caseId)}/decision`,
      body,
    ),

  // Checkpoint 15.3 -- the AI content review queue. The queue only ever returns
  // `pending_review` items; a candidate the forbidden-phrase scanner blocked is
  // never in it, and a decided one is not a queue.
  contentReviewQueue: (): Promise<ContentReviewQueue> =>
    api.get<ContentReviewQueue>("/admin/v1/content-review/items"),
  decideContentReview: (
    itemId: string,
    body: ContentReviewDecisionRequest,
  ): Promise<ContentReviewItem> =>
    api.post<ContentReviewItem>(
      `/admin/v1/content-review/items/${encodeURIComponent(itemId)}/decision`,
      body,
    ),

  // Checkpoint 15.4 -- aggregate statistics and the audit log. POST for the
  // audit query because an actor id does not belong in a URL that lands in
  // access logs.
  statistics: (window: { from?: string; to?: string } = {}): Promise<Dashboards> =>
    api.post<Dashboards>("/admin/v1/statistics", window),
  auditQuery: (filter: AuditQueryRequest): Promise<AuditViewPage> =>
    api.post<AuditViewPage>("/admin/v1/audit/query", filter),
  auditExport: (filter: AuditQueryRequest): Promise<{ csv: string; rowCount: number }> =>
    api.post<{ csv: string; rowCount: number }>("/admin/v1/audit/export", filter),

  // Checkpoint 15.5 -- break-glass. One call, and it carries the justification:
  // there is no "unlock" endpoint to reach first, so the client cannot express
  // fetching the record and explaining it afterwards.
  breakGlassReveal: (body: BreakGlassRevealRequest): Promise<BreakGlassRevealResponse> =>
    api.post<BreakGlassRevealResponse>("/admin/v1/break-glass/reveal", body),

  // Addendum B Checkpoint 16.3 -- the reference corpus (admin_corpus_manage,
  // platform_super_admin only per §B6 item 4).
  //
  // There is no `deleteCorpusDocument` here, and there is nothing to call if
  // there were: §B3 allows append and retire, so retire is the only terminal
  // action and the API exposes no other.
  searchCorpus: (body: CorpusSearchRequest = {}): Promise<CorpusDocumentPage> =>
    api.post<CorpusDocumentPage>("/admin/v1/corpus/documents/search", body),
  corpusDocument: (documentId: string): Promise<CorpusDocumentDetail> =>
    api.get<CorpusDocumentDetail>(`/admin/v1/corpus/documents/${encodeURIComponent(documentId)}`),
  createCorpusDocument: (body: CorpusDocumentCreateRequest): Promise<CorpusDocument> =>
    api.post<CorpusDocument>("/admin/v1/corpus/documents", body),
  editCorpusDocument: (
    documentId: string,
    body: CorpusDocumentEditRequest,
  ): Promise<CorpusDocument> =>
    api.post<CorpusDocument>(
      `/admin/v1/corpus/documents/${encodeURIComponent(documentId)}/edit`,
      body,
    ),
  publishCorpusDocument: (
    documentId: string,
    body: CorpusPublishRequest,
  ): Promise<CorpusVersionResult> =>
    api.post<CorpusVersionResult>(
      `/admin/v1/corpus/documents/${encodeURIComponent(documentId)}/publish`,
      body,
    ),
  retireCorpusDocument: (
    documentId: string,
    body: CorpusRetireRequest,
  ): Promise<CorpusVersionResult> =>
    api.post<CorpusVersionResult>(
      `/admin/v1/corpus/documents/${encodeURIComponent(documentId)}/retire`,
      body,
    ),
  corpusSources: (): Promise<SrcEnrichmentPage> =>
    api.get<SrcEnrichmentPage>("/admin/v1/corpus/sources"),
  // Owner decision 2026-10-18: a draft's text from a PDF/Word original or one
  // web page, and the original downloaded again. The bytes go up raw; the name
  // rides URL-encoded in a header (a header carries ASCII only).
  uploadCorpusFile: (
    documentId: string,
    file: File,
    contentType: string,
  ): Promise<CorpusDocument> =>
    api.postFile<CorpusDocument>(
      `/admin/v1/corpus/documents/${encodeURIComponent(documentId)}/file`,
      new RawUpload(file, contentType, { "x-somnus-filename": encodeURIComponent(file.name) }),
    ),
  fetchCorpusWebPage: (documentId: string, body: CorpusWebPageRequest): Promise<CorpusDocument> =>
    api.post<CorpusDocument>(
      `/admin/v1/corpus/documents/${encodeURIComponent(documentId)}/web-page`,
      body,
    ),
  downloadCorpusFile: (documentId: string): Promise<DownloadedFile> =>
    api.getFile(`/admin/v1/corpus/documents/${encodeURIComponent(documentId)}/file`),

  // --- Internal roles (admin_roles_assign, platform_super_admin only) ---
  assignRole: (body: AdminRoleAssignRequest): Promise<AdminRoleAssignResponse> =>
    api.post<AdminRoleAssignResponse>("/admin/v1/roles/assign", body),

  // The staff Drive (admin_drive, every internal role; ADR 0019). Every body
  // below is built by `drive/crypto.ts`: ciphertext, public keys and signatures.
  drive: driveEdge(),
};

/** The Drive's routes. A function so the paths are built in one place, with ids encoded. */
function driveEdge() {
  const base = "/admin/v1/drive";
  const share = (shareId: string) => `${base}/shares/${encodeURIComponent(shareId)}`;
  const node = (shareId: string, nodeId: string) =>
    `${share(shareId)}/nodes/${encodeURIComponent(nodeId)}`;
  const block = (shareId: string, nodeId: string, revision: number, index: number) =>
    `${node(shareId, nodeId)}/revisions/${revision}/blocks/${index}`;
  return {
    account: (): Promise<DriveAccount> => api.get<DriveAccount>(`${base}/account`),
    enroll: (body: DriveEnrollRequest): Promise<DriveAccount> =>
      api.post<DriveAccount>(`${base}/account`, body),
    rewrap: (body: DriveRewrapRequest): Promise<DriveAccount> =>
      api.post<DriveAccount>(`${base}/account/rewrap`, body),
    saveState: (body: DriveStateRequest): Promise<DriveAccount> =>
      api.post<DriveAccount>(`${base}/account/state`, body),
    reset: (body: DriveEnrollRequest): Promise<DriveAccount> =>
      api.post<DriveAccount>(`${base}/account/reset`, body),
    directory: (): Promise<DriveDirectory> => api.get<DriveDirectory>(`${base}/directory`),
    shares: (): Promise<DriveShareList> => api.get<DriveShareList>(`${base}/shares`),
    createShare: (body: DriveShareCreateRequest): Promise<DriveShareSummary> =>
      api.post<DriveShareSummary>(`${base}/shares`, body),
    share: (shareId: string): Promise<DriveShareDetail> =>
      api.get<DriveShareDetail>(share(shareId)),
    purgeShare: (shareId: string): Promise<DrivePurgeResult> =>
      api.post<DrivePurgeResult>(`${share(shareId)}/purge`),
    addMember: (shareId: string, body: DriveMemberAddRequest): Promise<DriveMember> =>
      api.post<DriveMember>(`${share(shareId)}/access`, body),
    acceptKey: (shareId: string, body: DriveMemberKeyAcceptRequest): Promise<DriveShareSummary> =>
      api.post<DriveShareSummary>(`${share(shareId)}/accept`, body),
    setRole: (shareId: string, userId: string, role: DriveRole): Promise<DriveMember> =>
      api.post<DriveMember>(`${share(shareId)}/access/${encodeURIComponent(userId)}/role`, {
        role,
      }),
    removeMember: (
      shareId: string,
      userId: string,
      body: DriveMemberRemoveRequest,
    ): Promise<DriveKeyGenerationResult> =>
      api.post<DriveKeyGenerationResult>(
        `${share(shareId)}/access/${encodeURIComponent(userId)}/remove`,
        body,
      ),
    createFolder: (shareId: string, body: DriveFolderCreateRequest): Promise<DriveNode> =>
      api.post<DriveNode>(`${share(shareId)}/folders`, body),
    startUpload: (
      shareId: string,
      body: DriveUploadStartRequest,
    ): Promise<DriveUploadStartResponse> =>
      api.post<DriveUploadStartResponse>(`${share(shareId)}/uploads`, body),
    putBlock: (
      shareId: string,
      nodeId: string,
      revision: number,
      index: number,
      bytes: Uint8Array,
    ): Promise<void> => api.putBytes(block(shareId, nodeId, revision, index), bytes),
    commit: (shareId: string, nodeId: string, revision: number): Promise<DriveNode> =>
      api.post<DriveNode>(`${node(shareId, nodeId)}/revisions/${revision}/commit`),
    readBlock: (
      shareId: string,
      nodeId: string,
      revision: number,
      index: number,
    ): Promise<DriveBlock> => api.get<DriveBlock>(block(shareId, nodeId, revision, index)),
    rename: (shareId: string, nodeId: string, body: DriveRenameRequest): Promise<DriveNode> =>
      api.post<DriveNode>(`${node(shareId, nodeId)}/rename`, body),
    move: (shareId: string, nodeId: string, body: DriveMoveRequest): Promise<DriveNode> =>
      api.post<DriveNode>(`${node(shareId, nodeId)}/move`, body),
    trash: (shareId: string, nodeId: string): Promise<DriveNode> =>
      api.post<DriveNode>(`${node(shareId, nodeId)}/trash`),
    restore: (shareId: string, nodeId: string): Promise<DriveNode> =>
      api.post<DriveNode>(`${node(shareId, nodeId)}/restore`),
    purgeNode: (shareId: string, nodeId: string): Promise<DrivePurgeResult> =>
      api.post<DrivePurgeResult>(`${node(shareId, nodeId)}/purge`),
  };
}

export type DriveEdge = ReturnType<typeof driveEdge>;
