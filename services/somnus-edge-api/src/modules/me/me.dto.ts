import { ProfilePatchRequestSchema } from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/**
 * Validated at the edge too (defense in depth) even though identity
 * re-validates: a malformed patch is rejected here before a downstream
 * call is ever made. Same Zod schema, single source of truth.
 */
export class ProfilePatchDto extends createZodDto(ProfilePatchRequestSchema) {}
