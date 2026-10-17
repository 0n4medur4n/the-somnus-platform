import {
  DriveEnrollRequestSchema,
  DriveFolderCreateRequestSchema,
  DriveMemberAddRequestSchema,
  DriveMemberKeyAcceptRequestSchema,
  DriveMemberRemoveRequestSchema,
  DriveMemberRoleRequestSchema,
  DriveMoveRequestSchema,
  DriveRenameRequestSchema,
  DriveRewrapRequestSchema,
  DriveShareCreateRequestSchema,
  DriveStateRequestSchema,
  DriveUploadStartRequestSchema,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/**
 * The staff Drive's request bodies (ADR 0019), validated at the edge before
 * anything is proxied -- the same Zod contracts the worker validates against.
 * They bound sizes and shapes; what is inside is ciphertext.
 */
export class DriveEnrollDto extends createZodDto(DriveEnrollRequestSchema) {}
export class DriveRewrapDto extends createZodDto(DriveRewrapRequestSchema) {}
export class DriveStateDto extends createZodDto(DriveStateRequestSchema) {}
export class DriveShareCreateDto extends createZodDto(DriveShareCreateRequestSchema) {}
export class DriveFolderCreateDto extends createZodDto(DriveFolderCreateRequestSchema) {}
export class DriveUploadStartDto extends createZodDto(DriveUploadStartRequestSchema) {}
export class DriveRenameDto extends createZodDto(DriveRenameRequestSchema) {}
export class DriveMoveDto extends createZodDto(DriveMoveRequestSchema) {}
export class DriveMemberAddDto extends createZodDto(DriveMemberAddRequestSchema) {}
export class DriveMemberKeyAcceptDto extends createZodDto(DriveMemberKeyAcceptRequestSchema) {}
export class DriveMemberRoleDto extends createZodDto(DriveMemberRoleRequestSchema) {}
export class DriveMemberRemoveDto extends createZodDto(DriveMemberRemoveRequestSchema) {}
