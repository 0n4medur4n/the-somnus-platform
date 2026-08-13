import {
  AnswerSubmitRequestSchema,
  AssessmentClaimRequestSchema,
  AssessmentCreateRequestSchema,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/** Validated at the edge before proxying to morpheo (single Zod source of truth). */
export class AssessmentCreateDto extends createZodDto(AssessmentCreateRequestSchema) {}
export class AnswerSubmitDto extends createZodDto(AnswerSubmitRequestSchema) {}
export class AssessmentClaimDto extends createZodDto(AssessmentClaimRequestSchema) {}
