import { z } from "zod";
import { LocaleSchema } from "../locale.js";
import { opaqueIdSchema } from "../uuid.js";

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

/** GET /v1/me */
export const MeResponseSchema = z.object({
  user: UserSchema,
  individualProfile: IndividualProfileSchema.nullable(),
  professionalProfile: ProfessionalProfileSchema.nullable(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/**
 * PATCH profile: individual and professional fields are mutually
 * exclusive on a single request -- a user is at most one of each kind
 * of profile, and only that profile's own fields are patchable here.
 * License/specialty changes are not included: those go through
 * verification, not a plain patch.
 */
export const ProfilePatchRequestSchema = z
  .object({
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().min(1).max(120).optional(),
    phone: z.string().min(1).max(32).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required." });
export type ProfilePatchRequest = z.infer<typeof ProfilePatchRequestSchema>;

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
