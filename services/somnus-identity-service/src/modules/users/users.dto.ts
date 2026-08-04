import { UserProvisionRequestSchema, UserResolveRequestSchema } from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/** Request body for `POST /internal/v1/users/resolve` (build plan §8.2). */
export class UserResolveDto extends createZodDto(UserResolveRequestSchema) {}

/** Request body for `POST /internal/v1/users/provision` (build plan §9.1). */
export class UserProvisionDto extends createZodDto(UserProvisionRequestSchema) {}
