import {
  StaffInvitationAcceptInternalRequestSchema,
  StaffInvitationCreateRequestSchema,
  StaffInvitationLookupRequestSchema,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

export class StaffInvitationCreateDto extends createZodDto(StaffInvitationCreateRequestSchema) {}
export class StaffInvitationLookupDto extends createZodDto(StaffInvitationLookupRequestSchema) {}
export class StaffInvitationAcceptDto extends createZodDto(
  StaffInvitationAcceptInternalRequestSchema,
) {}
