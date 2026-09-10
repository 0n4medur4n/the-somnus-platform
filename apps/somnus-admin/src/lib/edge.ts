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
  AdminVerificationCase,
  AdminVerificationDecisionRequest,
  AuditQueryRequest,
  AuditViewPage,
  BreakGlassRevealRequest,
  BreakGlassRevealResponse,
  ContentReviewDecisionRequest,
  ContentReviewItem,
  ContentReviewQueue,
  Dashboards,
  SessionResponse,
} from "@somnus/api-contracts";
import { api } from "./api.js";

/**
 * The console's entire backend surface (Addendum A §A2.1): the shared session
 * exchange, and `/admin/v1/*`. It never calls a consumer route -- the console
 * has no business composing `/v1/me` or reading anyone's profile, and keeping
 * that out of this file makes the boundary visible rather than a convention.
 *
 * Nothing here is capability-aware. The server decides; a call the acting admin
 * may not make comes back 403, and the console simply never renders the control
 * that would have made it.
 */
export const edge = {
  createSession: (idToken: string): Promise<SessionResponse> =>
    api.post<SessionResponse>("/v1/sessions", { idToken }),
  adminMe: (): Promise<AdminMeResponse> => api.get<AdminMeResponse>("/admin/v1/me"),
  logout: (): Promise<void> => api.del<void>("/v1/sessions/current"),

  // --- Users (admin_users_read / admin_account_status_write) ---
  searchUsers: (body: AdminUserSearchRequest): Promise<AdminUserSearchResponse> =>
    api.post<AdminUserSearchResponse>("/admin/v1/users/search", body),
  userDetail: (userId: string): Promise<AdminUserDetail> =>
    api.get<AdminUserDetail>(`/admin/v1/users/${encodeURIComponent(userId)}`),
  setUserStatus: (userId: string, body: AdminAccountStatusRequest): Promise<void> =>
    api.patch<void>(`/admin/v1/users/${encodeURIComponent(userId)}/status`, body),

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

  // --- Internal roles (admin_roles_assign, platform_super_admin only) ---
  assignRole: (body: AdminRoleAssignRequest): Promise<AdminRoleAssignResponse> =>
    api.post<AdminRoleAssignResponse>("/admin/v1/roles/assign", body),
};
