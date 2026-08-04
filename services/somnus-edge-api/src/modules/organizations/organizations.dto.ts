import {
  InvitationAcceptRequestSchema,
  InvitationCreateRequestSchema,
  OrganizationCreateRequestSchema,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/** Validated at the edge before proxying to identity (single Zod source of truth). */
export class OrganizationCreateDto extends createZodDto(OrganizationCreateRequestSchema) {}
export class InvitationCreateDto extends createZodDto(InvitationCreateRequestSchema) {}
export class InvitationAcceptDto extends createZodDto(InvitationAcceptRequestSchema) {}
