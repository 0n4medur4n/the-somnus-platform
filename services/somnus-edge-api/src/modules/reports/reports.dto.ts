import { ReportRenderRequestSchema } from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/** Validated at the edge before proxying to the report service (single Zod source of truth). */
export class ReportRenderDto extends createZodDto(ReportRenderRequestSchema) {}
