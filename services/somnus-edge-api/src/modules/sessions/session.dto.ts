import { SessionCreateRequestSchema } from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

export class SessionCreateDto extends createZodDto(SessionCreateRequestSchema) {}
