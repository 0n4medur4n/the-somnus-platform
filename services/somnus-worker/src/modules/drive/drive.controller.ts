import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type {
  DriveAccount,
  DriveDirectory,
  DriveEraseResult,
  DriveKeyGenerationResult,
  DriveMember,
  DriveNode,
  DrivePurgeResult,
  DriveShareDetail,
  DriveShareList,
  DriveShareSummary,
} from "@somnus/api-contracts";
import { InternalAuthGuard } from "../../common/guards/internal-auth.guard.js";
import {
  DriveBlockDto,
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
} from "./drive.dto.js";
import { DriveService } from "./drive.service.js";
import {
  blockIndexParam,
  DriveActor,
  DriveActorEmail,
  idParam,
  revisionParam,
} from "./drive-actor.js";

/**
 * The staff Drive's internal API (ADR 0019). Private service: edge-api is the
 * only caller, and it reaches these routes only after identity granted
 * `admin_drive` to the session's user.
 *
 * Everything that crosses this controller is ciphertext or a public key, so
 * there is nothing here worth logging and nothing is logged.
 */
@ApiTags("drive")
@Controller({ path: "internal/v1/drive" })
@UseGuards(InternalAuthGuard)
export class DriveController {
  constructor(private readonly drive: DriveService) {}

  @Get("account")
  @ApiOperation({ summary: "The caller's Drive identity: public keys and sealed private keys." })
  account(@DriveActor() actor: string): Promise<DriveAccount> {
    return this.drive.account(actor);
  }

  @Post("account")
  @ApiOperation({ summary: "Set up the Drive: public keys and sealed material only." })
  enroll(
    @DriveActor() actor: string,
    @DriveActorEmail() email: string,
    @Body() body: DriveEnrollDto,
  ): Promise<DriveAccount> {
    return this.drive.enroll(actor, email, body);
  }

  @Post("account/rewrap")
  @HttpCode(200)
  @ApiOperation({ summary: "A new passphrase (and, after a recovery, a new recovery code)." })
  rewrap(@DriveActor() actor: string, @Body() body: DriveRewrapDto): Promise<DriveAccount> {
    return this.drive.rewrap(actor, body);
  }

  @Post("account/state")
  @HttpCode(200)
  @ApiOperation({ summary: "Save the sealed list of verified colleague keys." })
  saveState(@DriveActor() actor: string, @Body() body: DriveStateDto): Promise<DriveAccount> {
    return this.drive.saveState(actor, body);
  }

  @Post("account/reset")
  @HttpCode(200)
  @ApiOperation({ summary: "Replace lost keys. What only the old keys could open is gone." })
  reset(
    @DriveActor() actor: string,
    @DriveActorEmail() email: string,
    @Body() body: DriveEnrollDto,
  ): Promise<DriveAccount> {
    return this.drive.reset(actor, email, body);
  }

  @Post("account/erase")
  @HttpCode(200)
  @ApiOperation({ summary: "Account deletion: leave every folder and delete the Drive identity." })
  erase(@DriveActor() actor: string): Promise<DriveEraseResult> {
    return this.drive.erase(actor);
  }

  @Get("directory")
  @ApiOperation({ summary: "Colleagues who set up the Drive, with their public keys." })
  directory(@DriveActor() actor: string): Promise<DriveDirectory> {
    return this.drive.directory(actor);
  }

  @Get("shares")
  @ApiOperation({ summary: "The shared folders the caller belongs to." })
  shares(@DriveActor() actor: string): Promise<DriveShareList> {
    return this.drive.listShares(actor);
  }

  @Post("shares")
  @ApiOperation({ summary: "Create a shared folder, owned by the caller." })
  createShare(
    @DriveActor() actor: string,
    @Body() body: DriveShareCreateDto,
  ): Promise<DriveShareSummary> {
    return this.drive.createShare(actor, body);
  }

  @Get("shares/:shareId")
  @ApiOperation({ summary: "One shared folder: its nodes and members." })
  share(@DriveActor() actor: string, @Param("shareId") shareId: string): Promise<DriveShareDetail> {
    return this.drive.shareDetail(actor, idParam(shareId));
  }

  @Post("shares/:shareId/purge")
  @HttpCode(200)
  @ApiOperation({ summary: "Delete a shared folder and everything in it. Owners only." })
  purgeShare(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
  ): Promise<DrivePurgeResult> {
    return this.drive.purgeShare(actor, idParam(shareId));
  }

  @Post("shares/:shareId/access")
  @ApiOperation({ summary: "Share the folder with a colleague (their wrapped copy of its key)." })
  addMember(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
    @Body() body: DriveMemberAddDto,
  ): Promise<DriveMember> {
    return this.drive.addMember(actor, idParam(shareId), body);
  }

  @Post("shares/:shareId/accept")
  @HttpCode(200)
  @ApiOperation({ summary: "Replace the caller's own copy of the folder key, re-signed by them." })
  acceptKey(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
    @Body() body: DriveMemberKeyAcceptDto,
  ): Promise<DriveShareSummary> {
    return this.drive.acceptKey(actor, idParam(shareId), body);
  }

  @Post("shares/:shareId/access/:userId/role")
  @HttpCode(200)
  @ApiOperation({ summary: "Change a member's role. A folder always keeps an owner." })
  setRole(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
    @Param("userId") userId: string,
    @Body() body: DriveMemberRoleDto,
  ): Promise<DriveMember> {
    return this.drive.setRole(actor, idParam(shareId), idParam(userId), body.role);
  }

  @Post("shares/:shareId/access/:userId/remove")
  @HttpCode(200)
  @ApiOperation({ summary: "Remove a member (or leave), rotating the folder key atomically." })
  removeMember(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
    @Param("userId") userId: string,
    @Body() body: DriveMemberRemoveDto,
  ): Promise<DriveKeyGenerationResult> {
    return this.drive.removeMember(actor, idParam(shareId), idParam(userId), body);
  }

  @Post("shares/:shareId/folders")
  @ApiOperation({ summary: "Create a folder." })
  createFolder(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
    @Body() body: DriveFolderCreateDto,
  ): Promise<DriveNode> {
    return this.drive.createFolder(actor, idParam(shareId), body);
  }

  @Post("shares/:shareId/uploads")
  @ApiOperation({ summary: "Start a file revision: its sealed metadata and signed manifest." })
  startUpload(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
    @Body() body: DriveUploadStartDto,
  ): Promise<{ nodeId: string; revision: number }> {
    return this.drive.startUpload(actor, idParam(shareId), body);
  }

  @Put("shares/:shareId/nodes/:nodeId/revisions/:revision/blocks/:index")
  @HttpCode(204)
  @ApiOperation({ summary: "Store one encrypted block." })
  async putBlock(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
    @Param("revision") revision: string,
    @Param("index") index: string,
    @Body() body: DriveBlockDto,
  ): Promise<void> {
    await this.drive.putBlock({
      actorId: actor,
      shareId: idParam(shareId),
      nodeId: idParam(nodeId),
      revision: revisionParam(revision),
      blockIndex: blockIndexParam(index),
      data: Buffer.from(body.data, "base64"),
    });
  }

  @Post("shares/:shareId/nodes/:nodeId/revisions/:revision/commit")
  @HttpCode(200)
  @ApiOperation({ summary: "Make a fully uploaded revision the current one." })
  commit(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
    @Param("revision") revision: string,
  ): Promise<DriveNode> {
    return this.drive.commit(actor, idParam(shareId), idParam(nodeId), revisionParam(revision));
  }

  @Get("shares/:shareId/nodes/:nodeId/revisions/:revision/blocks/:index")
  @ApiOperation({ summary: "Fetch one encrypted block of the current revision." })
  readBlock(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
    @Param("revision") revision: string,
    @Param("index") index: string,
  ): Promise<{ data: string }> {
    return this.drive.readBlock({
      actorId: actor,
      shareId: idParam(shareId),
      nodeId: idParam(nodeId),
      revision: revisionParam(revision),
      blockIndex: blockIndexParam(index),
    });
  }

  @Post("shares/:shareId/nodes/:nodeId/rename")
  @HttpCode(200)
  @ApiOperation({ summary: "Replace a node's sealed metadata (its name)." })
  rename(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: DriveRenameDto,
  ): Promise<DriveNode> {
    return this.drive.rename(actor, idParam(shareId), idParam(nodeId), body);
  }

  @Post("shares/:shareId/nodes/:nodeId/move")
  @HttpCode(200)
  @ApiOperation({ summary: "Move a node to another folder of the same shared folder." })
  move(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: DriveMoveDto,
  ): Promise<DriveNode> {
    return this.drive.move(actor, idParam(shareId), idParam(nodeId), body);
  }

  @Post("shares/:shareId/nodes/:nodeId/trash")
  @HttpCode(200)
  @ApiOperation({ summary: "Move a node to the trash." })
  trash(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
  ): Promise<DriveNode> {
    return this.drive.trash(actor, idParam(shareId), idParam(nodeId));
  }

  @Post("shares/:shareId/nodes/:nodeId/restore")
  @HttpCode(200)
  @ApiOperation({ summary: "Restore a node from the trash." })
  restore(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
  ): Promise<DriveNode> {
    return this.drive.restore(actor, idParam(shareId), idParam(nodeId));
  }

  @Post("shares/:shareId/nodes/:nodeId/purge")
  @HttpCode(200)
  @ApiOperation({ summary: "Delete a trashed node permanently. Owners only." })
  purgeNode(
    @DriveActor() actor: string,
    @Param("shareId") shareId: string,
    @Param("nodeId") nodeId: string,
  ): Promise<DrivePurgeResult> {
    return this.drive.purgeNode(actor, idParam(shareId), idParam(nodeId));
  }
}
