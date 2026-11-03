import {
  NotificationRecipientEraseRequestSchema,
  NotificationTaskSchema,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/** The Cloud Tasks payload, validated by the global nestjs-zod pipe (§3.4). */
export class NotificationTaskDto extends createZodDto(NotificationTaskSchema) {}

/** Account deletion: the address whose delivery records are erased. */
export class NotificationRecipientEraseDto extends createZodDto(
  NotificationRecipientEraseRequestSchema,
) {}
