import {
  PlatformInvitationAcceptRequestSchema,
  PlatformInvitationLookupRequestSchema,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";
export class LookupDto extends createZodDto(PlatformInvitationLookupRequestSchema) {}
export class AcceptDto extends createZodDto(PlatformInvitationAcceptRequestSchema) {}
