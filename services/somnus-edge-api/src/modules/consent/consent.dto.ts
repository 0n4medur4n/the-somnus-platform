import { ConsentCreateRequestSchema, ConsentWithdrawRequestSchema } from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/** Validated at the edge before proxying to identity (single Zod source of truth). */
export class ConsentCreateDto extends createZodDto(ConsentCreateRequestSchema) {}
export class ConsentWithdrawDto extends createZodDto(ConsentWithdrawRequestSchema) {}
