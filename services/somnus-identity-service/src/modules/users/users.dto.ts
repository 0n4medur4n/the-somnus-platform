import { UserResolveRequestSchema } from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/** Request body for `POST /internal/v1/users/resolve` (build plan §8.2). */
export class UserResolveDto extends createZodDto(UserResolveRequestSchema) {}
