import { UserProvisionRequestSchema, UserResolveRequestSchema } from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/** Request body for `POST /internal/v1/users/resolve` (build plan §8.2). */
export class UserResolveDto extends createZodDto(UserResolveRequestSchema) {}

/**
 * Request body for `POST /internal/v1/users/provision` (build plan §9.1,
 * role branch added in Addendum A Checkpoint 14.1).
 *
 * Declared as a value, not with `class X extends createZodDto(...)`: the
 * provision contract is a discriminated union over `role`, and a union is
 * not a legal base-constructor return type in TypeScript (TS2509). The
 * object createZodDto returns is unchanged, so swagger still generates the
 * body schema from Zod as a `oneOf` (build plan §3.4). Only the runtime
 * validation moves: it is bound explicitly on the handler parameter rather
 * than inferred from the metatype.
 *
 * The class createZodDto returns is anonymous (`AugmentedZodDto`), which is
 * what swagger would name the component; naming it here keeps the generated
 * document readable and collision-free if a second union DTO is added.
 */
export const UserProvisionDto = createZodDto(UserProvisionRequestSchema);
Object.defineProperty(UserProvisionDto, "name", { value: "UserProvisionDto" });
