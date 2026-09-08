import { RegistrationRequestSchema } from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/**
 * Request body for `POST /v1/registration` (build plan §9.1, role branch
 * added in Addendum A Checkpoint 14.1).
 *
 * Declared as a value, not with `class X extends createZodDto(...)`:
 * registration is a discriminated union over `role` (adult / parent /
 * professional), and a union is not a legal base-constructor return type in
 * TypeScript (TS2509). The object createZodDto returns is unchanged, so
 * swagger still generates the body schema from Zod as a `oneOf` (build plan
 * §3.4); only the runtime validation moves to the handler parameter.
 *
 * The class createZodDto returns is anonymous (`AugmentedZodDto`), which is
 * what swagger would name the component; naming it here keeps the generated
 * document readable and collision-free if a second union DTO is added.
 */
export const RegistrationDto = createZodDto(RegistrationRequestSchema);
Object.defineProperty(RegistrationDto, "name", { value: "RegistrationDto" });
