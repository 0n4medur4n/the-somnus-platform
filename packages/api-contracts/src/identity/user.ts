import { z } from "zod";
import { LocaleSchema } from "../locale.js";
import { MORPHEO_ROLES } from "../morpheo/enums.js";
import { opaqueIdSchema } from "../uuid.js";
import { OrganizationStatusSchema } from "./organization.js";
import { RoleKeySchema } from "./roles.js";

export const UserStatusSchema = z.enum(["active", "suspended", "deleted"]);

export const UserSchema = z.object({
  id: opaqueIdSchema,
  email: z.string().email(),
  locale: LocaleSchema,
  status: UserStatusSchema,
});
export type User = z.infer<typeof UserSchema>;

export const IndividualProfileSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  dateOfBirth: z.string().date().optional(),
  phone: z.string().min(1).max(32).optional(),
  /**
   * When the profile photo last changed; absent when there is none. The app
   * also uses it as the cache key of `GET /v1/me/photo`, so a new photo is
   * never hidden behind the old one.
   */
  photoUpdatedAt: z.iso.datetime().optional(),
});
export type IndividualProfile = z.infer<typeof IndividualProfileSchema>;

/** Build plan §11: specialty is profile information, never an authorization role. */
export const PROFESSIONAL_SPECIALTIES = [
  "family_physician",
  "pediatrician",
  "sleep_physician",
  "psychologist",
  "nurse",
  "pharmacist",
  "therapist",
] as const;
export const ProfessionalSpecialtySchema = z.enum(PROFESSIONAL_SPECIALTIES);

export const ProfessionalProfileSchema = z.object({
  specialty: ProfessionalSpecialtySchema,
  licenseNumber: z.string().min(1).max(64),
  verificationStatus: z.enum(["pending", "verified", "rejected"]),
});
export type ProfessionalProfile = z.infer<typeof ProfessionalProfileSchema>;

/** An organization the person is an active member of, with the roles they hold in it. */
export const MeOrganizationSchema = z.object({
  id: opaqueIdSchema,
  name: z.string(),
  status: OrganizationStatusSchema,
  roleKeys: z.array(RoleKeySchema),
});
export type MeOrganization = z.infer<typeof MeOrganizationSchema>;

/**
 * Who the account is for, so the app can show each person their own space.
 *
 * - `registrationRole`: the branch chosen at registration (Addendum A, A1);
 *   null for accounts created before it was recorded.
 * - `internalRoles`: platform staff roles (INTERNAL_ROLE_KEYS) only. Non-empty
 *   means the person works in the admin console; what they may do there is
 *   still decided per request by the capability matrix, never by this list.
 * - `organizations`: active memberships only.
 */
export const MeAccountSchema = z.object({
  registrationRole: z.enum(MORPHEO_ROLES).nullable(),
  internalRoles: z.array(RoleKeySchema),
  organizations: z.array(MeOrganizationSchema),
});
export type MeAccount = z.infer<typeof MeAccountSchema>;

/** GET /v1/me */
export const MeResponseSchema = z.object({
  user: UserSchema,
  individualProfile: IndividualProfileSchema.nullable(),
  professionalProfile: ProfessionalProfileSchema.nullable(),
  account: MeAccountSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** Every account holder is an adult: a minor never has an account (Addendum A, A1). */
export const MIN_ACCOUNT_HOLDER_AGE = 18;

/** Whole years between a calendar date of birth and `today` (both read as UTC dates). */
export function ageOnDate(dateOfBirth: string, today: Date): number {
  const [year, month, day] = dateOfBirth.split("-").map(Number) as [number, number, number];
  const months = (today.getUTCMonth() + 1 - month) * 100 + (today.getUTCDate() - day);
  return today.getUTCFullYear() - year - (months < 0 ? 1 : 0);
}

/** A date of birth an account holder can have: an adult, and a plausible one. */
export const AccountHolderDateOfBirthSchema = z.iso.date().refine(
  (value) => {
    const age = ageOnDate(value, new Date());
    return age >= MIN_ACCOUNT_HOLDER_AGE && age <= 120;
  },
  { message: "The account holder must be an adult." },
);

/** Digits, spaces, dashes, parentheses and an optional leading +. */
export const PhoneSchema = z
  .string()
  .min(6)
  .max(32)
  .regex(/^\+?[0-9 ()-]+$/);

/**
 * PATCH profile: individual and professional fields are mutually
 * exclusive on a single request -- a user is at most one of each kind
 * of profile, and only that profile's own fields are patchable here.
 * License/specialty changes are not included: those go through
 * verification, not a plain patch. `null` clears an optional field.
 * `locale` is the person's preferred language (stored on the user).
 */
export const ProfilePatchRequestSchema = z
  .object({
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().min(1).max(120).optional(),
    phone: PhoneSchema.nullable().optional(),
    dateOfBirth: AccountHolderDateOfBirthSchema.nullable().optional(),
    locale: LocaleSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required." });
export type ProfilePatchRequest = z.infer<typeof ProfilePatchRequestSchema>;

/**
 * `PUT /v1/me/profile/photo` on identity, called by edge-api only: edge-api
 * stores the image itself (private bucket) and records here whether there is
 * one. Identity never sees the image bytes.
 */
export const ProfilePhotoStateRequestSchema = z
  .object({
    present: z.boolean(),
  })
  .strict();
export type ProfilePhotoStateRequest = z.infer<typeof ProfilePhotoStateRequestSchema>;

/**
 * `POST /internal/v1/users/resolve` (build plan §20 Checkpoint 8.2):
 * edge-api authenticates the Firebase session, then resolves the
 * external provider user id (the Firebase UID) into the internal Somnus
 * user id it must forward as `x-somnus-actor-id`. Internal-only, like
 * the consent check. Resolve-only: a Firebase user with no linked
 * Somnus account is a 404, not an auto-provision (registration is a
 * separate flow), so this never creates identity state.
 */
export const UserResolveRequestSchema = z
  .object({
    providerUserId: z.string().min(1).max(128),
  })
  .strict();
export type UserResolveRequest = z.infer<typeof UserResolveRequestSchema>;

export const UserResolveResponseSchema = z
  .object({
    userId: opaqueIdSchema,
    email: z.string().email(),
    locale: LocaleSchema,
    status: UserStatusSchema,
  })
  .strict();
export type UserResolveResponse = z.infer<typeof UserResolveResponseSchema>;

/**
 * `POST /v1/registration` (build plan §20 Checkpoint 9.1): the SPA's
 * registration call. The Firebase identity (provider id + email) comes
 * from the verified session server-side, so the client only supplies
 * the individual-profile fields. edge-api forwards these plus the
 * session identity to identity's internal provision endpoint.
 */
/**
 * Minor age bands, verbatim from the §14a clinical artifact
 * (`roles[].age_bands` in morpheo_workflows_v1.json). Only the parent/guardian
 * branch carries one; the minor never has an account (Addendum A, A1).
 */
export const MORPHEO_MINOR_AGE_BANDS = [
  "0-3m",
  "4-11m",
  "1-2y",
  "3-5y",
  "6-12y",
  "13-17y",
] as const;
export const MinorAgeBandSchema = z.enum(MORPHEO_MINOR_AGE_BANDS);
export type MinorAgeBand = z.infer<typeof MinorAgeBandSchema>;

/**
 * Consent purposes captured at registration. Build plan §13: every purpose is
 * its own explicit checkbox, never bundled into one. Health-data processing is
 * deliberately NOT here -- it stays at the first assessment (Addendum A, A1).
 */
export const RegistrationConsentsSchema = z
  .object({
    termsAcceptance: z.literal(true),
    privacyPolicyAcknowledgement: z.literal(true),
  })
  .strict();
export type RegistrationConsents = z.infer<typeof RegistrationConsentsSchema>;

/**
 * Registration is ONE flow with a role branch (Addendum A, A1) -- not four
 * forms. The branch vocabulary is Morpheo's clinical role vocabulary
 * (MORPHEO_ROLES: adult | parent | professional), never a second parallel enum;
 * "parent" is the guardian branch.
 */
const registrationCommon = {
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  locale: LocaleSchema.optional(),
  consents: RegistrationConsentsSchema,
};

/** Adult: self-attested age. A minor age is rejected by the schema itself. */
const adultBranch = {
  role: z.literal("adult"),
  ageYears: z.number().int().min(18).max(120),
};
/** Parent/guardian: guardianship confirmation cannot be skipped (literal true). */
const parentBranch = {
  role: z.literal("parent"),
  guardianshipConfirmed: z.literal(true),
  minorAgeBand: MinorAgeBandSchema,
};
/**
 * Professional: supplies profile fields and requests verification. The account
 * behaves as an individual until a `professional_verifier` approves the case
 * (Addendum A, A1) -- this request never grants the professional role.
 */
const professionalBranch = {
  role: z.literal("professional"),
  specialty: ProfessionalSpecialtySchema,
  licenseNumber: z.string().min(1).max(64),
};

export const RegistrationRequestSchema = z.discriminatedUnion("role", [
  z.object({ ...registrationCommon, ...adultBranch }).strict(),
  z.object({ ...registrationCommon, ...parentBranch }).strict(),
  z.object({ ...registrationCommon, ...professionalBranch }).strict(),
]);
export type RegistrationRequest = z.infer<typeof RegistrationRequestSchema>;

/**
 * `POST /internal/v1/users/provision` (build plan §20 Checkpoint 9.1):
 * find-or-create the Somnus user for a Firebase identity and create its
 * individual profile. Idempotent -- provisioning an already-linked
 * provider id returns the existing user unchanged (re-registration is
 * not an error). Internal-only, like resolve.
 */
const provisionCommon = {
  ...registrationCommon,
  providerUserId: z.string().min(1).max(128),
  email: z.string().email(),
};

export const UserProvisionRequestSchema = z.discriminatedUnion("role", [
  z.object({ ...provisionCommon, ...adultBranch }).strict(),
  z.object({ ...provisionCommon, ...parentBranch }).strict(),
  z.object({ ...provisionCommon, ...professionalBranch }).strict(),
]);
export type UserProvisionRequest = z.infer<typeof UserProvisionRequestSchema>;
