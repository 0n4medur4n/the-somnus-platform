import { RegistrationRequestSchema } from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/** Body for `POST /v1/registration` -- profile fields only; the Firebase identity comes from the session. */
export class RegistrationDto extends createZodDto(RegistrationRequestSchema) {}
