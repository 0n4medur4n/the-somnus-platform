import { z } from "zod";

/**
 * TEMPORARY — replace with packages/api-contracts when GET /nox/v1/me exists.
 *
 * An explicit grant requires every field below, each the literal true.
 * Unknown keys are ignored. A missing field, a value that is not literal
 * true, or a body that is not an object is not a grant.
 */
export const NoxMeGrantSchema = z.object({
  verifiedProfessional: z.literal(true),
  noxAccess: z.literal(true),
});

export type NoxMeGrant = z.infer<typeof NoxMeGrantSchema>;

export function isExplicitNoxGrant(value: unknown): value is NoxMeGrant {
  return NoxMeGrantSchema.safeParse(value).success;
}
