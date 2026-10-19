import { z } from "zod";
import { LocaleSchema } from "../locale.js";
import { opaqueIdSchema } from "../uuid.js";
import { RoleKeySchema } from "./roles.js";
import { ProfessionalSpecialtySchema } from "./user.js";

/**
 * The admin console's operational surface (Addendum A §A4 Checkpoint 15.2).
 *
 * §A2.3 is the rule these shapes encode: administrative access and clinical
 * access are different things. Everything here is account metadata, membership
 * and process state. Nothing here reaches an assessment, an answer, a report or
 * a consent document's contents -- that needs break-glass (15.5), which is a
 * separate capability with a separate justification.
 */

export const ACCOUNT_STATUSES = ["active", "suspended", "deleted"] as const;
export const AccountStatusSchema = z.enum(ACCOUNT_STATUSES);

// --- Users -----------------------------------------------------------------

/** One row of the user search. Enough to find a person, and no more. */
export const AdminUserSummarySchema = z.object({
  id: opaqueIdSchema,
  email: z.string().email(),
  locale: LocaleSchema,
  status: AccountStatusSchema,
  createdAt: z.iso.datetime(),
});
export type AdminUserSummary = z.infer<typeof AdminUserSummarySchema>;

export const AdminUserSearchRequestSchema = z
  .object({
    /** Substring match on the address. The console's only way to find someone. */
    email: z.string().min(1).max(320).optional(),
    status: AccountStatusSchema.optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();
export type AdminUserSearchRequest = z.infer<typeof AdminUserSearchRequestSchema>;

export const AdminUserSearchResponseSchema = z.object({
  users: z.array(AdminUserSummarySchema),
  /** True when the result was cut off, so the console can say "narrow your search". */
  truncated: z.boolean(),
});
export type AdminUserSearchResponse = z.infer<typeof AdminUserSearchResponseSchema>;

/**
 * A single account, metadata only. The profile fields are the person's own
 * name and their professional standing -- what a support agent needs to know
 * they have the right person. There is no clinical field here by design.
 */
export const AdminUserDetailSchema = z.object({
  user: AdminUserSummarySchema,
  individualProfile: z
    .object({
      firstName: z.string(),
      lastName: z.string(),
      dateOfBirth: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      gender: z.enum(["male", "female", "prefer_not_to_say"]).nullable().optional(),
      country: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      registrationRole: z.enum(["adult", "parent", "professional"]).nullable(),
    })
    .nullable(),
  professionalProfile: z
    .object({
      licenseNumber: z.string().optional(),
      specialty: ProfessionalSpecialtySchema,
      verificationStatus: z.enum(["pending", "verified", "rejected"]),
    })
    .nullable(),
  internalRoles: z.array(RoleKeySchema),
  organizationIds: z.array(opaqueIdSchema),
  updatedAt: z.iso.datetime().optional(),
  roleAssignments: z
    .array(
      z.object({
        roleKey: RoleKeySchema,
        organizationId: opaqueIdSchema.nullable(),
        assignedAt: z.iso.datetime(),
      }),
    )
    .optional(),
  organizations: z
    .array(
      z.object({
        id: opaqueIdSchema,
        name: z.string(),
        status: z.enum(["active", "suspended"]),
        membershipStatus: z.enum(["active", "inactive", "removed"]),
      }),
    )
    .optional(),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetailSchema>;

export const AdminAccountStatusRequestSchema = z
  .object({
    // Only these two: an account is never *deleted* from here. Erasure is the
    // deletion-request path, which is auditable and irreversible (§13.2).
    status: z.enum(["active", "suspended"]),
    reason: z.string().min(3).max(500),
  })
  .strict();
export type AdminAccountStatusRequest = z.infer<typeof AdminAccountStatusRequestSchema>;

// --- Deletion requests -----------------------------------------------------

export const AdminDeletionRequestSchema = z.object({
  id: opaqueIdSchema,
  userId: opaqueIdSchema,
  status: z.enum(["pending", "completed", "cancelled"]),
  requestedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type AdminDeletionRequest = z.infer<typeof AdminDeletionRequestSchema>;

export const AdminDeletionDecisionRequestSchema = z
  .object({
    decision: z.enum(["complete", "cancel"]),
    reason: z.string().min(3).max(500),
  })
  .strict();
export type AdminDeletionDecisionRequest = z.infer<typeof AdminDeletionDecisionRequestSchema>;

// --- Organizations ---------------------------------------------------------

export const AdminOrganizationSummarySchema = z.object({
  id: opaqueIdSchema,
  name: z.string(),
  status: z.enum(["active", "suspended"]),
  createdAt: z.iso.datetime(),
});
export type AdminOrganizationSummary = z.infer<typeof AdminOrganizationSummarySchema>;

export const AdminOrganizationCreateRequestSchema = z
  .object({ name: z.string().min(2).max(200) })
  .strict();
export type AdminOrganizationCreateRequest = z.infer<typeof AdminOrganizationCreateRequestSchema>;

export const AdminOrganizationStatusRequestSchema = z
  .object({
    status: z.enum(["active", "suspended"]),
    reason: z.string().min(3).max(500),
  })
  .strict();
export type AdminOrganizationStatusRequest = z.infer<typeof AdminOrganizationStatusRequestSchema>;

export const AdminOrganizationMemberSchema = z.object({
  membershipId: opaqueIdSchema,
  userId: opaqueIdSchema,
  status: z.enum(["active", "inactive", "removed"]),
});
export type AdminOrganizationMember = z.infer<typeof AdminOrganizationMemberSchema>;

// --- Professional verification queue ---------------------------------------

/**
 * A case waiting on a `professional_verifier`. It carries the licence number
 * because that is the thing being verified; it carries no clinical data at all.
 */
export const AdminVerificationCaseSchema = z.object({
  caseId: opaqueIdSchema,
  professionalProfileId: opaqueIdSchema,
  userId: opaqueIdSchema,
  specialty: ProfessionalSpecialtySchema,
  licenseNumber: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  openedAt: z.iso.datetime(),
});
export type AdminVerificationCase = z.infer<typeof AdminVerificationCaseSchema>;

export const AdminVerificationDecisionRequestSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    /**
     * Required for both outcomes, not just refusals. An approval that granted
     * someone access to other people's health data with no recorded reason is
     * exactly what an audit needs to be able to question later.
     */
    reason: z.string().min(3).max(500),
  })
  .strict();
export type AdminVerificationDecisionRequest = z.infer<
  typeof AdminVerificationDecisionRequestSchema
>;

// --- Internal role assignment (platform_super_admin only) ------------------

export const AdminRoleAssignRequestSchema = z
  .object({
    targetUserId: opaqueIdSchema,
    roleKey: RoleKeySchema,
  })
  .strict();
export type AdminRoleAssignRequest = z.infer<typeof AdminRoleAssignRequestSchema>;

export const AdminRoleAssignResponseSchema = z.object({
  assignmentId: opaqueIdSchema,
  targetUserId: opaqueIdSchema,
  roleKey: RoleKeySchema,
  /** `console` here always; `bootstrap` only ever comes from the one-time script. */
  source: z.enum(["console", "bootstrap"]),
});
export type AdminRoleAssignResponse = z.infer<typeof AdminRoleAssignResponseSchema>;

/** How many weeks of sign-ups the console overview charts. */
export const ADMIN_USERS_OVERVIEW_WEEKS = 12;

/**
 * `GET /admin/v1/users/overview` -- the console's dashboard figures about
 * accounts (capability `admin_users_read`).
 *
 * Counts only. No email, no id, no profile field: the overview exists to show
 * the shape of the platform, and a number cannot be turned back into a person.
 * Computed live from identity's own tables, so it is right even while the
 * analytics event transport is not wired.
 */
export const AdminUsersOverviewSchema = z
  .object({
    total: z.number().int().nonnegative(),
    byStatus: z
      .object({
        active: z.number().int().nonnegative(),
        suspended: z.number().int().nonnegative(),
        deleted: z.number().int().nonnegative(),
      })
      .strict(),
    /** Registration role branch (Addendum A A1); `unknown` = never completed registration. */
    byRegistrationRole: z
      .object({
        adult: z.number().int().nonnegative(),
        parent: z.number().int().nonnegative(),
        professional: z.number().int().nonnegative(),
        unknown: z.number().int().nonnegative(),
      })
      .strict(),
    newLast7Days: z.number().int().nonnegative(),
    newLast30Days: z.number().int().nonnegative(),
    /** Oldest first, zero-filled, each week starting on a Monday (UTC). */
    weekly: z
      .array(z.object({ weekStart: z.iso.date(), count: z.number().int().nonnegative() }).strict())
      .length(ADMIN_USERS_OVERVIEW_WEEKS),
    generatedAt: z.iso.datetime(),
  })
  .strict();
export type AdminUsersOverview = z.infer<typeof AdminUsersOverviewSchema>;
