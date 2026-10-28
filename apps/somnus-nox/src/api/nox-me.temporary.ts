import { z } from "zod";

/**
 * TEMPORARY — replace with packages/api-contracts when GET /nox/v1/me exists.
 *
 * An explicit grant is the only passing shape: both flags literal true, and
 * no other fields. Anything else (missing flag, stringly boolean, extra
 * property, error body) is not a grant.
 */
export const NoxMeGrantSchema = z
  .object({
    verifiedProfessional: z.literal(true),
    noxAccess: z.literal(true),
  })
  .strict();

export type NoxMeGrant = z.infer<typeof NoxMeGrantSchema>;

export function isExplicitNoxGrant(value: unknown): value is NoxMeGrant {
  return NoxMeGrantSchema.safeParse(value).success;
}
