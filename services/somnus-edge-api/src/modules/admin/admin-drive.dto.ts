import {
  DriveDictationRequestSchema,
  DriveEnrollRequestSchema,
  DriveFolderCreateRequestSchema,
  DriveMemberAddRequestSchema,
  DriveMemberKeyAcceptRequestSchema,
  DriveMemberRemoveRequestSchema,
  DriveMemberRoleRequestSchema,
  DriveMoveRequestSchema,
  DriveProofreadRequestSchema,
  DriveReadAloudRequestSchema,
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
/** Voice (owner decision 2026-11-02): a language, and for reading aloud, plain text. */
export class DriveDictationDto extends createZodDto(DriveDictationRequestSchema) {}
export class DriveReadAloudDto extends createZodDto(DriveReadAloudRequestSchema) {}
/** Proofreading (owner decision 2026-11-02): a few paragraphs of a document, and its language. */
export class DriveProofreadDto extends createZodDto(DriveProofreadRequestSchema) {}
