import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  DRIVE_BLOCK_MAX_BYTES,
  DRIVE_MAX_BLOCKS,
  type DriveAccount,
  DriveAccountSchema,
  type DriveBlock,
  DriveBlockSchema,
  type DriveDirectory,
  DriveDirectorySchema,
  type DriveKeyGenerationResult,
  DriveKeyGenerationResultSchema,
  type DriveMember,
  DriveMemberSchema,
  type DriveNode,
  DriveNodeSchema,
  type DrivePurgeResult,
  DrivePurgeResultSchema,
  type DriveShareDetail,
  DriveShareDetailSchema,
  type DriveShareList,
  DriveShareListSchema,
  type DriveShareSummary,
  DriveShareSummarySchema,
  type DriveUploadStartResponse,
  DriveUploadStartResponseSchema,
  opaqueIdSchema,
} from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { ZodType } from "zod";
import { correlationOf } from "../../common/composition.util.js";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { AdminAuditInterceptor, type RequestWithAuditDetail } from "./admin-audit.interceptor.js";
import { AdminCapabilityGuard } from "./admin-capability.guard.js";
import {
  DriveEnrollDto,
  DriveFolderCreateDto,
  DriveMemberAddDto,
  DriveMemberKeyAcceptDto,
  DriveMemberRemoveDto,
  DriveMemberRoleDto,
  DriveMoveDto,
  DriveRenameDto,
  DriveRewrapDto,
  DriveShareCreateDto,
  DriveStateDto,
  DriveUploadStartDto,
} from "./admin-drive.dto.js";
import { AdminDriveService } from "./admin-drive.service.js";
import { AdminRoute } from "./admin-route.decorator.js";

const BASE = "/internal/v1/drive";

function invalid(correlationId: string): SomnusError {
  return new SomnusError(ErrorCode.VALIDATION_FAILED, "Invalid path parameter.", {
    correlationId,
  });
}

/** Path ids are validated here, before they are spliced into an internal URL. */
function id(value: string, correlationId: string): string {
  const parsed = opaqueIdSchema.safeParse(value);
  if (!parsed.success) throw invalid(correlationId);
  return parsed.data;
}

function int(value: string, min: number, max: number, correlationId: string): number {
  if (!/^\d{1,7}$/.test(value)) throw invalid(correlationId);
  const n = Number(value);
  if (n < min || n > max) throw invalid(correlationId);
  return n;
}

/**
 * The staff Drive (owner decision 2026-10-17, ADR 0019).
 *
 * Every route requires `admin_drive`, which identity grants to every internal
 * role: the capability opens the section, and what anyone can read inside it is
 * decided per folder by the Drive module and, underneath that, by keys the
 * platform never holds. Every route also emits its audit event, with the folder
 * or node id as the subject -- never anything about the content, which nobody
 * on the server side could read anyway.
 *
 * Blocks are the one raw body: `application/octet-stream`, parsed with the
 * Drive's own size ceiling (see `bootstrap/harden.ts`), and forwarded to the
 * worker as base64 because the internal hop is JSON.
 */
@ApiTags("admin")
@Controller({ path: "admin/v1/drive" })
@UseGuards(SessionGuard, AdminCapabilityGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminDriveController {
  constructor(private readonly drive: AdminDriveService) {}

  private call<T>(input: {
    session: SessionRecord | undefined;
    correlationId: string | undefined;
    method: "GET" | "POST" | "PUT";
    path: string;
    schema?: ZodType<T>;
    body?: unknown;
    withEmail?: boolean;
  }): Promise<T> {
    const correlationId = correlationOf(input.correlationId);
    let actorEmail: string | undefined;
    if (input.withEmail) {
      // The label colleagues see in the share dialog comes from the server-side
      // session, never from the request -- nobody enrolls under another name.
      if (!input.session?.email) {
        throw new SomnusError(ErrorCode.FORBIDDEN, "The session carries no email.", {
          correlationId,
        });
      }
      actorEmail = input.session.email;
    }
    return this.drive.forward({
      method: input.method,
      path: input.path,
      // The guard resolved and approved the actor before this handler ran.
      actorId: input.session?.somnusUserId ?? "",
      ...(actorEmail !== undefined ? { actorEmail } : {}),
      correlationId,
      ...(input.schema ? { schema: input.schema } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
    });
  }

  // --- the caller's Drive identity ---

  @Get("account")
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_account.viewed.v1",
    entity: "drive_account",
  })
  @ApiOperation({ summary: "The caller's Drive identity (sealed; only its owner can open it)." })
  account(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveAccount> {
    return this.call({
      session,
      correlationId,
      method: "GET",
      path: `${BASE}/account`,
      schema: DriveAccountSchema,
    });
  }

  @Post("account")
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_account.enrolled.v1",
    entity: "drive_account",
  })
  @ApiOperation({ summary: "Set up the Drive: public keys and sealed private keys only." })
  enroll(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: DriveEnrollDto,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveAccount> {
    return this.call({
      session,
      correlationId,
      method: "POST",
      path: `${BASE}/account`,
      schema: DriveAccountSchema,
      body,
      withEmail: true,
    });
  }

  @Post("account/rewrap")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_account.rewrapped.v1",
    entity: "drive_account",
  })
  @ApiOperation({ summary: "A new Drive passphrase (and, after a recovery, a new code)." })
  rewrap(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: DriveRewrapDto,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveAccount> {
    return this.call({
      session,
      correlationId,
      method: "POST",
      path: `${BASE}/account/rewrap`,
      schema: DriveAccountSchema,
      body,
    });
  }

  @Post("account/state")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_account.state_saved.v1",
    entity: "drive_account",
  })
  @ApiOperation({ summary: "Save the sealed list of verified colleague keys." })
  saveState(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: DriveStateDto,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveAccount> {
    return this.call({
      session,
      correlationId,
      method: "POST",
      path: `${BASE}/account/state`,
      schema: DriveAccountSchema,
      body,
    });
  }

  @Post("account/reset")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_account.reset.v1",
    entity: "drive_account",
  })
  @ApiOperation({ summary: "Replace lost Drive keys. What only the old keys opened is gone." })
  reset(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: DriveEnrollDto,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveAccount> {
    return this.call({
      session,
      correlationId,
      method: "POST",
      path: `${BASE}/account/reset`,
      schema: DriveAccountSchema,
      body,
      withEmail: true,
    });
  }

  @Get("directory")
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_directory.viewed.v1",
    entity: "drive_directory",
  })
  @ApiOperation({ summary: "Colleagues who set up the Drive, with their public keys." })
  directory(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveDirectory> {
    return this.call({
      session,
      correlationId,
      method: "GET",
      path: `${BASE}/directory`,
      schema: DriveDirectorySchema,
    });
  }

  // --- shared folders ---

  @Get("shares")
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_share.listed.v1",
    entity: "drive_share",
  })
  @ApiOperation({ summary: "The shared folders the caller belongs to." })
  shares(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveShareList> {
    return this.call({
      session,
      correlationId,
      method: "GET",
      path: `${BASE}/shares`,
      schema: DriveShareListSchema,
    });
  }

  @Post("shares")
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_share.created.v1",
    entity: "drive_share",
  })
  @ApiOperation({ summary: "Create a shared folder, owned by the caller." })
  createShare(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: DriveShareCreateDto,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveShareSummary> {
    request.adminAuditDetail = { subjectId: body.shareId };
    return this.call({
      session,
      correlationId,
      method: "POST",
      path: `${BASE}/shares`,
      schema: DriveShareSummarySchema,
      body,
    });
  }

  @Get("shares/:shareId")
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_share.viewed.v1",
    entity: "drive_share",
  })
  @ApiOperation({ summary: "One shared folder: its (sealed) nodes and its members." })
  share(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveShareDetail> {
    const share = id(shareId, correlationOf(correlationId));
    request.adminAuditDetail = { subjectId: share };
    return this.call({
      session,
      correlationId,
      method: "GET",
      path: `${BASE}/shares/${share}`,
      schema: DriveShareDetailSchema,
    });
  }

  @Post("shares/:shareId/purge")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_share.purged.v1",
    entity: "drive_share",
  })
  @ApiOperation({ summary: "Delete a shared folder and everything in it. Owners only." })
  purgeShare(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DrivePurgeResult> {
    const share = id(shareId, correlationOf(correlationId));
    request.adminAuditDetail = { subjectId: share };
    return this.call({
      session,
      correlationId,
      method: "POST",
      path: `${BASE}/shares/${share}/purge`,
      schema: DrivePurgeResultSchema,
    });
  }

  // --- members ---

  @Post("shares/:shareId/access")
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_member.added.v1",
    entity: "drive_share",
  })
  @ApiOperation({ summary: "Share a folder with a colleague." })
  addMember(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Body() body: DriveMemberAddDto,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveMember> {
    const share = id(shareId, correlationOf(correlationId));
    request.adminAuditDetail = { subjectId: share, data: { memberUserId: body.userId } };
    return this.call({
      session,
      correlationId,
      method: "POST",
      path: `${BASE}/shares/${share}/access`,
      schema: DriveMemberSchema,
      body,
    });
  }

  @Post("shares/:shareId/accept")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_member.key_accepted.v1",
    entity: "drive_share",
  })
  @ApiOperation({ summary: "Replace the caller's own copy of the folder key, re-signed by them." })
  acceptKey(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Body() body: DriveMemberKeyAcceptDto,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveShareSummary> {
    const share = id(shareId, correlationOf(correlationId));
    request.adminAuditDetail = { subjectId: share, data: { keyGeneration: body.keyGeneration } };
    return this.call({
      session,
      correlationId,
      method: "POST",
      path: `${BASE}/shares/${share}/accept`,
      schema: DriveShareSummarySchema,
      body,
    });
  }

  @Post("shares/:shareId/access/:userId/role")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_member.role_changed.v1",
    entity: "drive_share",
  })
  @ApiOperation({ summary: "Change a member's role in a folder." })
  setRole(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Param("userId") userId: string,
    @Body() body: DriveMemberRoleDto,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveMember> {
    const correlation = correlationOf(correlationId);
    const share = id(shareId, correlation);
    const member = id(userId, correlation);
    request.adminAuditDetail = {
      subjectId: share,
      data: { memberUserId: member, role: body.role },
    };
    return this.call({
      session,
      correlationId,
      method: "POST",
      path: `${BASE}/shares/${share}/access/${member}/role`,
      schema: DriveMemberSchema,
      body,
    });
  }

  @Post("shares/:shareId/access/:userId/remove")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_member.removed.v1",
    entity: "drive_share",
  })
  @ApiOperation({ summary: "Remove a member (or leave), rotating the folder key." })
  removeMember(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Param("userId") userId: string,
    @Body() body: DriveMemberRemoveDto,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveKeyGenerationResult> {
    const correlation = correlationOf(correlationId);
    const share = id(shareId, correlation);
    const member = id(userId, correlation);
    request.adminAuditDetail = {
      subjectId: share,
      data: { memberUserId: member, keyGeneration: body.keyGeneration },
    };
    return this.call({
      session,
      correlationId,
      method: "POST",
      path: `${BASE}/shares/${share}/access/${member}/remove`,
      schema: DriveKeyGenerationResultSchema,
      body,
    });
  }

  // --- folders and files ---

  @Post("shares/:shareId/folders")
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_folder.created.v1",
    entity: "drive_node",
  })
  @ApiOperation({ summary: "Create a folder." })
  createFolder(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Body() body: DriveFolderCreateDto,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveNode> {
    const share = id(shareId, correlationOf(correlationId));
    request.adminAuditDetail = { subjectId: body.nodeId, data: { shareId: share } };
    return this.call({
      session,
      correlationId,
      method: "POST",
      path: `${BASE}/shares/${share}/folders`,
      schema: DriveNodeSchema,
      body,
    });
  }

  @Post("shares/:shareId/uploads")
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_upload.started.v1",
    entity: "drive_node",
  })
  @ApiOperation({ summary: "Start a file revision." })
  startUpload(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Body() body: DriveUploadStartDto,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveUploadStartResponse> {
    const share = id(shareId, correlationOf(correlationId));
    request.adminAuditDetail = {
      subjectId: body.nodeId,
      data: { shareId: share, revision: body.revision },
    };
    return this.call({
      session,
      correlationId,
      method: "POST",
      path: `${BASE}/shares/${share}/uploads`,
      schema: DriveUploadStartResponseSchema,
      body,
    });
  }

  @Put("shares/:shareId/nodes/:nodeId/revisions/:revision/blocks/:index")
  @HttpCode(204)
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_block.uploaded.v1",
    entity: "drive_node",
  })
  @ApiOperation({ summary: "Upload one encrypted block (application/octet-stream)." })
  async putBlock(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
    @Param("revision") revision: string,
    @Param("index") index: string,
    @Body() body: unknown,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<void> {
    const correlation = correlationOf(correlationId);
    const share = id(shareId, correlation);
    const node = id(nodeId, correlation);
    const rev = int(revision, 1, 1_000_000, correlation);
    const blockIndex = int(index, 0, DRIVE_MAX_BLOCKS - 1, correlation);
    if (!Buffer.isBuffer(body) || body.length === 0 || body.length > DRIVE_BLOCK_MAX_BYTES) {
      throw new SomnusError(ErrorCode.VALIDATION_FAILED, "A block must be raw bytes.", {
        correlationId: correlation,
      });
    }
    request.adminAuditDetail = {
      subjectId: node,
      data: { shareId: share, revision: rev, blockIndex },
    };
    await this.call({
      session,
      correlationId,
      method: "PUT",
      path: `${BASE}/shares/${share}/nodes/${node}/revisions/${rev}/blocks/${blockIndex}`,
      body: { data: body.toString("base64") },
    });
  }

  @Post("shares/:shareId/nodes/:nodeId/revisions/:revision/commit")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_upload.committed.v1",
    entity: "drive_node",
  })
  @ApiOperation({ summary: "Make a fully uploaded revision the current one." })
  commit(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
    @Param("revision") revision: string,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveNode> {
    const correlation = correlationOf(correlationId);
    const share = id(shareId, correlation);
    const node = id(nodeId, correlation);
    const rev = int(revision, 1, 1_000_000, correlation);
    request.adminAuditDetail = { subjectId: node, data: { shareId: share, revision: rev } };
    return this.call({
      session,
      correlationId,
      method: "POST",
      path: `${BASE}/shares/${share}/nodes/${node}/revisions/${rev}/commit`,
      schema: DriveNodeSchema,
    });
  }

  @Get("shares/:shareId/nodes/:nodeId/revisions/:revision/blocks/:index")
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_block.downloaded.v1",
    entity: "drive_node",
  })
  @ApiOperation({ summary: "Download one encrypted block of the current revision." })
  readBlock(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
    @Param("revision") revision: string,
    @Param("index") index: string,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveBlock> {
    const correlation = correlationOf(correlationId);
    const share = id(shareId, correlation);
    const node = id(nodeId, correlation);
    const rev = int(revision, 1, 1_000_000, correlation);
    const blockIndex = int(index, 0, DRIVE_MAX_BLOCKS - 1, correlation);
    request.adminAuditDetail = {
      subjectId: node,
      data: { shareId: share, revision: rev, blockIndex },
    };
    return this.call({
      session,
      correlationId,
      method: "GET",
      path: `${BASE}/shares/${share}/nodes/${node}/revisions/${rev}/blocks/${blockIndex}`,
      schema: DriveBlockSchema,
    });
  }

  @Post("shares/:shareId/nodes/:nodeId/rename")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_node.renamed.v1",
    entity: "drive_node",
  })
  @ApiOperation({ summary: "Replace a node's sealed name." })
  rename(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: DriveRenameDto,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveNode> {
    return this.nodeAction({ session, shareId, nodeId, request, correlationId }, "rename", body);
  }

  @Post("shares/:shareId/nodes/:nodeId/move")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_node.moved.v1",
    entity: "drive_node",
  })
  @ApiOperation({ summary: "Move a node within its shared folder." })
  move(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: DriveMoveDto,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveNode> {
    return this.nodeAction({ session, shareId, nodeId, request, correlationId }, "move", body);
  }

  @Post("shares/:shareId/nodes/:nodeId/trash")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_node.trashed.v1",
    entity: "drive_node",
  })
  @ApiOperation({ summary: "Move a node to the trash." })
  trash(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveNode> {
    return this.nodeAction({ session, shareId, nodeId, request, correlationId }, "trash");
  }

  @Post("shares/:shareId/nodes/:nodeId/restore")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_node.restored.v1",
    entity: "drive_node",
  })
  @ApiOperation({ summary: "Restore a node from the trash." })
  restore(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DriveNode> {
    return this.nodeAction({ session, shareId, nodeId, request, correlationId }, "restore");
  }

  @Post("shares/:shareId/nodes/:nodeId/purge")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_drive",
    eventType: "admin.drive_node.purged.v1",
    entity: "drive_node",
  })
  @ApiOperation({ summary: "Delete a trashed node permanently. Owners only." })
  purgeNode(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<DrivePurgeResult> {
    return this.nodeAction(
      { session, shareId, nodeId, request, correlationId },
      "purge",
      undefined,
      DrivePurgeResultSchema,
    );
  }

  private nodeAction<T = DriveNode>(
    ctx: {
      session: SessionRecord | undefined;
      shareId: string;
      nodeId: string;
      request: RequestWithAuditDetail;
      correlationId: string | undefined;
    },
    action: "rename" | "move" | "trash" | "restore" | "purge",
    body?: unknown,
    schema: ZodType<T> = DriveNodeSchema as unknown as ZodType<T>,
  ): Promise<T> {
    const correlation = correlationOf(ctx.correlationId);
    const share = id(ctx.shareId, correlation);
    const node = id(ctx.nodeId, correlation);
    ctx.request.adminAuditDetail = { subjectId: node, data: { shareId: share } };
    return this.call({
      session: ctx.session,
      correlationId: ctx.correlationId,
      method: "POST",
      path: `${BASE}/shares/${share}/nodes/${node}/${action}`,
      schema,
      ...(body !== undefined ? { body } : {}),
    });
  }
}
