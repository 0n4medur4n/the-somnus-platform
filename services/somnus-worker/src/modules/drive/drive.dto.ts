import {
  DriveBlockSchema,
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

/** The Drive's request bodies (ADR 0019), validated by the global nestjs-zod pipe. */
export class DriveEnrollDto extends createZodDto(DriveEnrollRequestSchema) {}
export class DriveRewrapDto extends createZodDto(DriveRewrapRequestSchema) {}
export class DriveStateDto extends createZodDto(DriveStateRequestSchema) {}
export class DriveShareCreateDto extends createZodDto(DriveShareCreateRequestSchema) {}
export class DriveFolderCreateDto extends createZodDto(DriveFolderCreateRequestSchema) {}
export class DriveUploadStartDto extends createZodDto(DriveUploadStartRequestSchema) {}
export class DriveBlockDto extends createZodDto(DriveBlockSchema) {}
export class DriveRenameDto extends createZodDto(DriveRenameRequestSchema) {}
export class DriveMoveDto extends createZodDto(DriveMoveRequestSchema) {}
export class DriveMemberAddDto extends createZodDto(DriveMemberAddRequestSchema) {}
export class DriveMemberKeyAcceptDto extends createZodDto(DriveMemberKeyAcceptRequestSchema) {}
export class DriveMemberRoleDto extends createZodDto(DriveMemberRoleRequestSchema) {}
export class DriveMemberRemoveDto extends createZodDto(DriveMemberRemoveRequestSchema) {}
