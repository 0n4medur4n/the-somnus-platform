import { z } from "zod";
import { MORPHEO_ROLES } from "../morpheo/enums.js";
import { opaqueIdSchema } from "../uuid.js";

/**
 * Analytics events for the Phase 15 dashboards (Addendum A §A2.4 / Checkpoint
 * 14.3), carried in the §17 envelope like every other platform event.
 *
 * These are the ONLY events whose `data` reaches BigQuery as a validated
 * allowlist rather than a denylist sweep: each payload below is `.strict()` and
 * holds nothing but the funnel dimension and an opaque id. Build plan §9 forbids
 * names, email addresses, questionnaire answers, health free text, report
 * content and tokens in BigQuery; the schemas here make that a property of the
 * contract instead of a property of any particular producer behaving well.
 *
 * The opaque user id lives in the envelope's `subject`, never in `data`, and the
 * audit exporter drops subject ids before anything leaves the service.
 */

/** The registration role branch (Addendum A §A1). Same vocabulary as Morpheo's roles (§14a). */
export const RoleBranchSchema = z.enum(MORPHEO_ROLES);
export type RoleBranch = z.infer<typeof RoleBranchSchema>;

/** Registration submitted: the provision request passed validation and is being processed. */
export const RegistrationStartedDataSchema = z.object({ roleBranch: RoleBranchSchema }).strict();

/** Registration succeeded: the user, the profile and both consent receipts exist. */
export const RegistrationCompletedDataSchema = z.object({ roleBranch: RoleBranchSchema }).strict();

/** A professional verification case was opened (self-declared professional, Addendum A §A1). */
export const VerificationRequestedDataSchema = z.object({ caseId: opaqueIdSchema }).strict();

export const VERIFICATION_DECISIONS = ["approved", "rejected"] as const;
export const VerificationDecisionSchema = z.enum(VERIFICATION_DECISIONS);
export type VerificationDecision = z.infer<typeof VerificationDecisionSchema>;

/**
 * A verification case was resolved by a `professional_verifier`. Emitted by the
 * admin console in Checkpoint 15.2; the funnel and its tests are ready for it
 * here so the dashboard's data source does not have to change then.
 */
export const VerificationDecidedDataSchema = z
  .object({
    caseId: opaqueIdSchema,
    decision: VerificationDecisionSchema,
    /** Case opened -> decided, in milliseconds. Feeds "median time to verification" (§A2.4). */
    timeToDecisionMs: z.number().int().nonnegative(),
  })
  .strict();

/** An organization invitation was issued. The invited address is NEVER carried. */
export const InvitationCreatedDataSchema = z.object({ invitationId: opaqueIdSchema }).strict();

/** The pre-login accept screen looked the invitation up (Checkpoint 14.2). */
export const InvitationPreviewedDataSchema = z.object({ invitationId: opaqueIdSchema }).strict();

/** The invitation was accepted and the membership attached. */
export const InvitationAcceptedDataSchema = z.object({ invitationId: opaqueIdSchema }).strict();

export const INVITATION_EXPIRY_STAGES = ["preview", "accept"] as const;
export const InvitationExpiryStageSchema = z.enum(INVITATION_EXPIRY_STAGES);

/**
 * An invitation was refused for being past its deadline. Emitted where the
 * refusal actually happens, so the funnel records expiry as something a person
 * ran into, not as a row a sweeper wrote at some later time.
 */
export const InvitationExpiredDataSchema = z
  .object({
    invitationId: opaqueIdSchema,
    stage: InvitationExpiryStageSchema,
  })
  .strict();

export const ANALYTICS_EVENT_TYPES = [
  "identity.registration.started.v1",
  "identity.registration.completed.v1",
  "identity.professional.verification.requested.v1",
  "identity.professional.verification.decided.v1",
  "identity.organization.invitation.created.v1",
  "identity.organization.invitation.previewed.v1",
  "identity.organization.invitation.accepted.v1",
  "identity.organization.invitation.expired.v1",
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

/**
 * The allowlist the exporter enforces: an event type here has its `data` parsed
 * with this schema before export, so an unknown key is dropped rather than
 * carried through on the strength of not matching a forbidden name.
 */
export const ANALYTICS_EVENT_DATA_SCHEMAS = {
  "identity.registration.started.v1": RegistrationStartedDataSchema,
  "identity.registration.completed.v1": RegistrationCompletedDataSchema,
  "identity.professional.verification.requested.v1": VerificationRequestedDataSchema,
  "identity.professional.verification.decided.v1": VerificationDecidedDataSchema,
  "identity.organization.invitation.created.v1": InvitationCreatedDataSchema,
  "identity.organization.invitation.previewed.v1": InvitationPreviewedDataSchema,
  "identity.organization.invitation.accepted.v1": InvitationAcceptedDataSchema,
  "identity.organization.invitation.expired.v1": InvitationExpiredDataSchema,
} as const satisfies Record<AnalyticsEventType, z.ZodObject>;

export function isAnalyticsEventType(value: string): value is AnalyticsEventType {
  return (ANALYTICS_EVENT_TYPES as ReadonlyArray<string>).includes(value);
}

/**
 * Field names that must never appear in an analytics payload (build plan §9).
 * Asserted against the SHAPE of every schema above, not against sample values,
 * so a forbidden field cannot be introduced by a future edit and go unnoticed
 * because no test happened to construct an event containing it.
 */
export const FORBIDDEN_ANALYTICS_FIELDS: ReadonlyArray<string> = Object.freeze([
  "name",
  "firstname",
  "first_name",
  "lastname",
  "last_name",
  "fullname",
  "full_name",
  "email",
  "emailaddress",
  "email_address",
  "phone",
  "address",
  "dob",
  "dateofbirth",
  "date_of_birth",
  "ssn",
  "password",
  "token",
  "cookie",
  "secret",
  "authorization",
  "answer",
  "answers",
  "freetext",
  "free_text",
  "healthdata",
  "health_data",
  "reportbody",
  "report_body",
  "content",
  "userid",
  "user_id",
  "provideruserid",
]);
