import { EventEnvelopeSchema } from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/** An audit event envelope (§17), validated by the global nestjs-zod pipe. */
export class AuditEventDto extends createZodDto(EventEnvelopeSchema) {}
