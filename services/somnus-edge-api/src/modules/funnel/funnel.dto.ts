import {
  FunnelAnswerRequestSchema,
  FunnelCreateRequestSchema,
  FunnelRewindRequestSchema,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/**
 * Validated at the edge before proxying to morpheo (single Zod source of truth):
 * free text with an email, a phone or a DNI/NIE is refused here, and again in morpheo.
 */
export class FunnelCreateDto extends createZodDto(FunnelCreateRequestSchema) {}
export class FunnelAnswerDto extends createZodDto(FunnelAnswerRequestSchema) {}
export class FunnelRewindDto extends createZodDto(FunnelRewindRequestSchema) {}
