import {
  ConsentCheckRequestSchema,
  ConsentCreateRequestSchema,
  ConsentWithdrawRequestSchema,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

export class ConsentCreateDto extends createZodDto(ConsentCreateRequestSchema) {}
export class ConsentWithdrawDto extends createZodDto(ConsentWithdrawRequestSchema) {}
export class ConsentCheckDto extends createZodDto(ConsentCheckRequestSchema) {}
