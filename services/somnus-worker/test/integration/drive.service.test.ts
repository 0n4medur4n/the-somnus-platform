import {
  type DriveEnrollRequest,
  type DriveMemberKeyInput,
  type DriveMetaSealed,
  type DriveNodeKeyInput,
  UUIDv7,
} from "@somnus/api-contracts";
import { SomnusError } from "@somnus/errors";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../../src/common/clock.js";
import { createDriveDb, createDrivePool } from "../../src/modules/drive/db/drive-db.client.js";
import { loadDriveDbConfig } from "../../src/modules/drive/db/drive-db.config.js";
import {
  runDriveMigrationsDown,
  runDriveMigrationsUp,
} from "../../src/modules/drive/db/migrate.js";
import { DriveRepository } from "../../src/modules/drive/db/repositories/index.js";
import {
  driveAccounts,
  driveBlocks,
  driveMembers,
  driveNodes,
  driveShares,
  driveUploads,
} from "../../src/modules/drive/db/schema/index.js";
import { DriveService } from "../../src/modules/drive/drive.service.js";

/**
 * The staff Drive's rules against real MySQL (ADR 0019, build plan §19).
 *
 * The browser does the cryptography; these tests do not need it. Every sealed
 * field below is random bytes of the right length, because to the server that
 * is exactly what a sealed field is.
 */

const pool = createDrivePool(loadDriveDbConfig(process.env));
const db = createDriveDb(pool);
const repo = new DriveRepository(db);

class TestClock implements Clock {
  current = new Date("2026-10-17T10:00:00.000Z");
  now(): Date {
    return new Date(this.current);
  }
}
const clock = new TestClock();
const drive = new DriveService(repo, clock);

function b64(n: number): string {
  const bytes = Buffer.alloc(n);
  for (let i = 0; i < n; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return bytes.toString("base64");
}

const enrollBody = (): DriveEnrollRequest => ({
  encPublicKey: b64(91),
  signPublicKey: b64(91),
  privateKeys: { iv: b64(12), ct: b64(300) },
  passphraseWrap: {
    kdf: "PBKDF2-SHA256",
    iterations: 600_000,
    salt: b64(16),
    iv: b64(12),
    ct: b64(48),
  },
  recoveryWrap: { kdf: "HKDF-SHA256", salt: b64(16), iv: b64(12), ct: b64(48) },
});
const memberKey = (): DriveMemberKeyInput => ({
  ephemeralPublicKey: b64(91),
  iv: b64(12),
  ct: b64(48),
  signature: b64(64),
});
const nodeKey = (): DriveNodeKeyInput => ({ iv: b64(12), ct: b64(48) });
const meta = (): DriveMetaSealed => ({ iv: b64(12), ct: b64(60) });

async function reason(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SomnusError) return { code: error.code, reason: error.details["reason"] };
    throw error;
  }
  return "no error";
}

const alice = UUIDv7();
const bob = UUIDv7();
const carol = UUIDv7();

async function enrollAll(): Promise<void> {
  await drive.enroll(alice, "alice@thesomnus.com", enrollBody());
  await drive.enroll(bob, "bob@thesomnus.com", enrollBody());
  await drive.enroll(carol, "carol@thesomnus.com", enrollBody());
}

async function newShare(owner: string): Promise<{ shareId: string; rootId: string }> {
  const shareId = UUIDv7();
  const rootId = UUIDv7();
  await drive.createShare(owner, {
    shareId,
    root: { nodeId: rootId, nodeKey: nodeKey(), meta: meta(), signature: b64(64) },
    ownerKey: memberKey(),
  });
  return { shareId, rootId };
}

/** Uploads a file of `blocks` blocks, each `size` bytes, and commits it. */
async function uploadFile(input: {
  actor: string;
  shareId: string;
  parentId: string;
  blocks: number;
  size?: number;
}): Promise<string> {
  const nodeId = UUIDv7();
  const size = input.size ?? 100;
  await drive.startUpload(input.actor, input.shareId, {
    nodeId,
    revision: 1,
    newFile: { parentId: input.parentId, nodeKey: nodeKey(), keyGeneration: 1 },
    blockCount: input.blocks,
    sizeBytes: input.blocks * size,
    contentHash: b64(32),
    meta: meta(),
    signature: b64(64),
  });
  for (let i = 0; i < input.blocks; i += 1) {
    await drive.putBlock({
      actorId: input.actor,
      shareId: input.shareId,
      nodeId,
      revision: 1,
      blockIndex: i,
      data: Buffer.alloc(size, i),
    });
  }
  await drive.commit(input.actor, input.shareId, nodeId, 1);
  return nodeId;
}

beforeEach(async () => {
  for (const table of [driveBlocks, driveUploads, driveNodes, driveMembers, driveShares]) {
    await db.delete(table);
  }
  await db.delete(driveAccounts);
  clock.current = new Date("2026-10-17T10:00:00.000Z");
});

afterAll(async () => {
  await pool.end();
});

describe("accounts", () => {
  it("enrolls once, returns the sealed material to its owner, and refuses a second enrollment", async () => {
    const body = enrollBody();
    const account = await drive.enroll(alice, "alice@thesomnus.com", body);
    expect(account.passphraseWrap).toEqual(body.passphraseWrap);
    expect(account.keyVersion).toBe(1);
    expect(await reason(drive.enroll(alice, "alice@thesomnus.com", enrollBody()))).toEqual({
      code: "CONFLICT",
      reason: "drive_account_exists",
    });
  });

  it("someone who never set up the Drive has no account and no directory", async () => {
    expect(await reason(drive.account(alice))).toEqual({
      code: "NOT_FOUND",
      reason: "drive_account_missing",
    });
    expect(await reason(drive.directory(alice))).toEqual({
      code: "NOT_FOUND",
      reason: "drive_account_missing",
    });
  });

  it("the directory lists public keys only", async () => {
    await enrollAll();
    const directory = await drive.directory(alice);
    expect(directory.entries).toHaveLength(3);
    for (const entry of directory.entries) {
      expect(Object.keys(entry).sort()).toEqual(
        ["email", "encPublicKey", "keyVersion", "signPublicKey", "userId"].sort(),
      );
    }
  });

  it("a new passphrase replaces only the passphrase wrap", async () => {
    const body = enrollBody();
    await drive.enroll(alice, "alice@thesomnus.com", body);
    const next = enrollBody().passphraseWrap;
    const account = await drive.rewrap(alice, { passphraseWrap: next });
    expect(account.passphraseWrap).toEqual(next);
    expect(account.recoveryWrap).toEqual(body.recoveryWrap);
    expect(account.privateKeys).toEqual(body.privateKeys);
  });

  it("saves the sealed state", async () => {
    await drive.enroll(alice, "alice@thesomnus.com", enrollBody());
    const state = { iv: b64(12), ct: b64(200) };
    expect((await drive.saveState(alice, { state })).state).toEqual(state);
  });
});

describe("membership decides who may ask for a folder (negative first)", () => {
  it("a colleague who was not given the folder cannot see, list or read it", async () => {
    await enrollAll();
    const { shareId, rootId } = await newShare(alice);
    const fileId = await uploadFile({ actor: alice, shareId, parentId: rootId, blocks: 1 });

    expect((await drive.listShares(bob)).shares).toHaveLength(0);
    expect(await reason(drive.shareDetail(bob, shareId))).toEqual({
      code: "NOT_FOUND",
      reason: "drive_not_a_member",
    });
    expect(
      await reason(
        drive.readBlock({ actorId: bob, shareId, nodeId: fileId, revision: 1, blockIndex: 0 }),
      ),
    ).toEqual({ code: "NOT_FOUND", reason: "drive_not_a_member" });
  });

  it("a node id from another folder is not found through this one", async () => {
    await enrollAll();
    const mine = await newShare(alice);
    const theirs = await newShare(bob);
    const theirFile = await uploadFile({
      actor: bob,
      shareId: theirs.shareId,
      parentId: theirs.rootId,
      blocks: 1,
    });
    expect(
      await reason(
        drive.readBlock({
          actorId: alice,
          shareId: mine.shareId,
          nodeId: theirFile,
          revision: 1,
          blockIndex: 0,
        }),
      ),
    ).toEqual({ code: "NOT_FOUND", reason: "drive_invalid_parent" });
  });

  it("a viewer reads but cannot add, rename, move or delete", async () => {
    await enrollAll();
    const { shareId, rootId } = await newShare(alice);
    const fileId = await uploadFile({ actor: alice, shareId, parentId: rootId, blocks: 1 });
    await drive.addMember(alice, shareId, {
      userId: bob,
      role: "viewer",
      keyGeneration: 1,
      memberKey: memberKey(),
    });

    const block = await drive.readBlock({
      actorId: bob,
      shareId,
      nodeId: fileId,
      revision: 1,
      blockIndex: 0,
    });
    expect(Buffer.from(block.data, "base64")).toEqual(Buffer.alloc(100, 0));

    const insufficient = { code: "FORBIDDEN", reason: "drive_role_insufficient" };
    expect(
      await reason(
        drive.createFolder(bob, shareId, {
          nodeId: UUIDv7(),
          parentId: rootId,
          keyGeneration: 1,
          nodeKey: nodeKey(),
          meta: meta(),
          signature: b64(64),
        }),
      ),
    ).toEqual(insufficient);
    expect(
      await reason(drive.rename(bob, shareId, fileId, { meta: meta(), signature: b64(64) })),
    ).toEqual(insufficient);
    expect(await reason(drive.trash(bob, shareId, fileId))).toEqual(insufficient);
    expect(
      await reason(
        drive.addMember(bob, shareId, {
          userId: carol,
          role: "viewer",
          keyGeneration: 1,
          memberKey: memberKey(),
        }),
      ),
    ).toEqual(insufficient);
  });

  it("an editor edits but cannot share the folder or delete permanently", async () => {
    await enrollAll();
    const { shareId, rootId } = await newShare(alice);
    await drive.addMember(alice, shareId, {
      userId: bob,
      role: "editor",
      keyGeneration: 1,
      memberKey: memberKey(),
    });
    const fileId = await uploadFile({ actor: bob, shareId, parentId: rootId, blocks: 1 });
    await drive.trash(bob, shareId, fileId);
    expect(await reason(drive.purgeNode(bob, shareId, fileId))).toEqual({
      code: "FORBIDDEN",
      reason: "drive_role_insufficient",
    });
    // Renaming the shared folder itself renames it for everyone: owners only.
    expect(
      await reason(drive.rename(bob, shareId, rootId, { meta: meta(), signature: b64(64) })),
    ).toEqual({ code: "FORBIDDEN", reason: "drive_role_insufficient" });
  });
});

describe("sharing", () => {
  it("shares only with colleagues who set up the Drive, once, under the current key", async () => {
    await drive.enroll(alice, "alice@thesomnus.com", enrollBody());
    const { shareId } = await newShare(alice);
    const add = (userId: string, keyGeneration = 1) =>
      drive.addMember(alice, shareId, {
        userId,
        role: "viewer",
        keyGeneration,
        memberKey: memberKey(),
      });

    expect(await reason(add(bob))).toEqual({
      code: "NOT_FOUND",
      reason: "drive_recipient_unknown",
    });
    await drive.enroll(bob, "bob@thesomnus.com", enrollBody());
    expect(await reason(add(bob, 2))).toEqual({
      code: "CONFLICT",
      reason: "drive_stale_key_generation",
    });
    const member = await add(bob);
    expect(member).toMatchObject({ userId: bob, email: "bob@thesomnus.com", role: "viewer" });
    expect(await reason(add(bob))).toEqual({ code: "CONFLICT", reason: "drive_already_member" });

    const bobShares = await drive.listShares(bob);
    expect(bobShares.shares).toHaveLength(1);
    expect(bobShares.shares[0]).toMatchObject({ role: "viewer", memberCount: 2 });
    // The wrapped key carries who granted it, so Bob's browser can check the signature.
    expect(bobShares.shares[0]?.memberKey.signedBy).toBe(alice);
  });

  it("a member re-signs their own copy, at the current generation only, and it is theirs alone", async () => {
    await enrollAll();
    const { shareId } = await newShare(alice);
    await drive.addMember(alice, shareId, {
      userId: bob,
      role: "viewer",
      keyGeneration: 1,
      memberKey: memberKey(),
    });
    const own = memberKey();
    const summary = await drive.acceptKey(bob, shareId, { keyGeneration: 1, memberKey: own });
    expect(summary.memberKey).toMatchObject({ ...own, signedBy: bob, keyGeneration: 1 });
    // Who granted access is still on record.
    const members = (await drive.shareDetail(alice, shareId)).members;
    expect(members.find((m) => m.userId === bob)?.grantedBy).toBe(alice);
    // Alice's copy is untouched.
    expect((await drive.listShares(alice)).shares[0]?.memberKey.signedBy).toBe(alice);

    expect(
      await reason(drive.acceptKey(bob, shareId, { keyGeneration: 2, memberKey: memberKey() })),
    ).toEqual({ code: "CONFLICT", reason: "drive_stale_key_generation" });
    expect(
      await reason(drive.acceptKey(carol, shareId, { keyGeneration: 1, memberKey: memberKey() })),
    ).toEqual({ code: "NOT_FOUND", reason: "drive_not_a_member" });
  });

  it("a folder always keeps an owner", async () => {
    await enrollAll();
    const { shareId } = await newShare(alice);
    expect(await reason(drive.setRole(alice, shareId, alice, "editor"))).toEqual({
      code: "CONFLICT",
      reason: "drive_last_owner",
    });
    await drive.addMember(alice, shareId, {
      userId: bob,
      role: "owner",
      keyGeneration: 1,
      memberKey: memberKey(),
    });
    expect((await drive.setRole(alice, shareId, alice, "editor")).role).toBe("editor");
  });
});

describe("removing a member rotates the folder key", () => {
  async function setup() {
    await enrollAll();
    const { shareId, rootId } = await newShare(alice);
    const fileId = await uploadFile({ actor: alice, shareId, parentId: rootId, blocks: 1 });
    for (const userId of [bob, carol]) {
      await drive.addMember(alice, shareId, {
        userId,
        role: "editor",
        keyGeneration: 1,
        memberKey: memberKey(),
      });
    }
    return { shareId, rootId, fileId };
  }

  it("refuses an incomplete rotation and changes nothing", async () => {
    const { shareId, rootId } = await setup();
    const result = await reason(
      drive.removeMember(alice, shareId, bob, {
        keyGeneration: 2,
        memberKeys: [{ userId: alice, memberKey: memberKey() }],
        nodeKeys: [{ nodeId: rootId, nodeKey: nodeKey() }],
      }),
    );
    expect(result).toEqual({ code: "CONFLICT", reason: "drive_incomplete_rotation" });
    expect((await drive.shareDetail(bob, shareId)).share.keyGeneration).toBe(1);
  });

  it("refuses a rotation that skips or repeats a generation", async () => {
    const { shareId } = await setup();
    expect(
      await reason(
        drive.removeMember(alice, shareId, bob, { keyGeneration: 3, memberKeys: [], nodeKeys: [] }),
      ),
    ).toEqual({ code: "CONFLICT", reason: "drive_stale_key_generation" });
  });

  it("a complete rotation removes them, rewraps everyone else and every node", async () => {
    const { shareId, rootId, fileId } = await setup();
    const newRootKey = nodeKey();
    const result = await drive.removeMember(alice, shareId, bob, {
      keyGeneration: 2,
      memberKeys: [alice, carol].map((userId) => ({ userId, memberKey: memberKey() })),
      nodeKeys: [
        { nodeId: rootId, nodeKey: newRootKey },
        { nodeId: fileId, nodeKey: nodeKey() },
      ],
    });
    expect(result).toEqual({ keyGeneration: 2 });

    expect((await drive.listShares(bob)).shares).toHaveLength(0);
    expect(
      await reason(
        drive.readBlock({ actorId: bob, shareId, nodeId: fileId, revision: 1, blockIndex: 0 }),
      ),
    ).toEqual({ code: "NOT_FOUND", reason: "drive_not_a_member" });

    const detail = await drive.shareDetail(carol, shareId);
    expect(detail.share.keyGeneration).toBe(2);
    expect(detail.share.memberKey.keyGeneration).toBe(2);
    expect(detail.members.map((m) => m.userId).sort()).toEqual([alice, carol].sort());
    const root = detail.nodes.find((n) => n.id === rootId);
    expect(root?.nodeKey).toEqual({ ...newRootKey, keyGeneration: 2 });
  });

  it("anyone may leave; nobody but an owner removes someone else", async () => {
    const { shareId, rootId, fileId } = await setup();
    expect(
      await reason(
        drive.removeMember(bob, shareId, carol, { keyGeneration: 2, memberKeys: [], nodeKeys: [] }),
      ),
    ).toEqual({ code: "FORBIDDEN", reason: "drive_role_insufficient" });

    await drive.removeMember(bob, shareId, bob, {
      keyGeneration: 2,
      memberKeys: [alice, carol].map((userId) => ({ userId, memberKey: memberKey() })),
      nodeKeys: [rootId, fileId].map((nodeId) => ({ nodeId, nodeKey: nodeKey() })),
    });
    expect((await drive.listShares(bob)).shares).toHaveLength(0);
  });

  it("the last person in a folder deletes it rather than leaving it", async () => {
    await enrollAll();
    const { shareId } = await newShare(alice);
    expect(
      await reason(
        drive.removeMember(alice, shareId, alice, {
          keyGeneration: 2,
          memberKeys: [],
          nodeKeys: [],
        }),
      ),
    ).toEqual({ code: "CONFLICT", reason: "drive_last_owner" });
    expect(await drive.purgeShare(alice, shareId)).toEqual({ purged: 1 });
    expect((await drive.listShares(alice)).shares).toHaveLength(0);
  });
});

describe("files", () => {
  it("a file is invisible until every block is in and it is committed", async () => {
    await drive.enroll(alice, "alice@thesomnus.com", enrollBody());
    const { shareId, rootId } = await newShare(alice);
    const nodeId = UUIDv7();
    await drive.startUpload(alice, shareId, {
      nodeId,
      revision: 1,
      newFile: { parentId: rootId, nodeKey: nodeKey(), keyGeneration: 1 },
      blockCount: 2,
      sizeBytes: 200,
      contentHash: b64(32),
      meta: meta(),
      signature: b64(64),
    });
    expect((await drive.shareDetail(alice, shareId)).nodes.map((n) => n.id)).toEqual([rootId]);

    await drive.putBlock({
      actorId: alice,
      shareId,
      nodeId,
      revision: 1,
      blockIndex: 0,
      data: Buffer.alloc(100),
    });
    expect(await reason(drive.commit(alice, shareId, nodeId, 1))).toEqual({
      code: "CONFLICT",
      reason: "drive_upload_incomplete",
    });
    expect(
      await reason(
        drive.putBlock({
          actorId: alice,
          shareId,
          nodeId,
          revision: 1,
          blockIndex: 2,
          data: Buffer.alloc(100),
        }),
      ),
    ).toEqual({ code: "VALIDATION_FAILED", reason: "drive_upload_incomplete" });

    await drive.putBlock({
      actorId: alice,
      shareId,
      nodeId,
      revision: 1,
      blockIndex: 1,
      data: Buffer.alloc(100),
    });
    const committed = await drive.commit(alice, shareId, nodeId, 1);
    expect(committed).toMatchObject({ revision: 1, blockCount: 2, sizeBytes: 200 });
    expect((await drive.shareDetail(alice, shareId)).nodes).toHaveLength(2);
  });

  it("a new revision replaces the old one, and the old blocks are gone", async () => {
    await drive.enroll(alice, "alice@thesomnus.com", enrollBody());
    const { shareId, rootId } = await newShare(alice);
    const nodeId = await uploadFile({ actor: alice, shareId, parentId: rootId, blocks: 1 });
    const revise = (revision: number) =>
      drive.startUpload(alice, shareId, {
        nodeId,
        revision,
        blockCount: 1,
        sizeBytes: 5,
        contentHash: b64(32),
        meta: meta(),
        signature: b64(64),
      });
    expect(await reason(revise(3))).toEqual({
      code: "CONFLICT",
      reason: "drive_revision_conflict",
    });
    await revise(2);
    await drive.putBlock({
      actorId: alice,
      shareId,
      nodeId,
      revision: 2,
      blockIndex: 0,
      data: Buffer.from("hello"),
    });
    await drive.commit(alice, shareId, nodeId, 2);

    expect(
      await reason(
        drive.readBlock({ actorId: alice, shareId, nodeId, revision: 1, blockIndex: 0 }),
      ),
    ).toEqual({ code: "CONFLICT", reason: "drive_revision_conflict" });
    const current = await drive.readBlock({
      actorId: alice,
      shareId,
      nodeId,
      revision: 2,
      blockIndex: 0,
    });
    expect(Buffer.from(current.data, "base64").toString()).toBe("hello");
    const stored = await db.execute(sql`SELECT COUNT(*) AS n FROM drive_blocks`);
    expect((stored[0] as unknown as Array<{ n: number }>)[0]?.n).toBe(1);
  });

  it("an upload abandoned for a day is cleared, and so is the file it started", async () => {
    await drive.enroll(alice, "alice@thesomnus.com", enrollBody());
    const { shareId, rootId } = await newShare(alice);
    const abandoned = UUIDv7();
    await drive.startUpload(alice, shareId, {
      nodeId: abandoned,
      revision: 1,
      newFile: { parentId: rootId, nodeKey: nodeKey(), keyGeneration: 1 },
      blockCount: 1,
      sizeBytes: 10,
      contentHash: b64(32),
      meta: meta(),
      signature: b64(64),
    });
    clock.current = new Date("2026-10-18T11:00:00.000Z");
    await uploadFile({ actor: alice, shareId, parentId: rootId, blocks: 1 });
    expect(await repo.findNode(abandoned)).toBeNull();
    expect(await repo.findUpload(abandoned, 1)).toBeNull();
  });
});

describe("folders, trash and permanent deletion", () => {
  it("moves within the folder, never into itself or a trashed folder", async () => {
    await drive.enroll(alice, "alice@thesomnus.com", enrollBody());
    const { shareId, rootId } = await newShare(alice);
    const folder = async (parentId: string) => {
      const nodeId = UUIDv7();
      await drive.createFolder(alice, shareId, {
        nodeId,
        parentId,
        keyGeneration: 1,
        nodeKey: nodeKey(),
        meta: meta(),
        signature: b64(64),
      });
      return nodeId;
    };
    const a = await folder(rootId);
    const a1 = await folder(a);
    const b = await folder(rootId);

    expect(await reason(drive.move(alice, shareId, a, { parentId: a1 }))).toEqual({
      code: "CONFLICT",
      reason: "drive_invalid_parent",
    });
    expect(await reason(drive.move(alice, shareId, rootId, { parentId: b }))).toEqual({
      code: "CONFLICT",
      reason: "drive_root_node",
    });
    expect((await drive.move(alice, shareId, a, { parentId: b })).parentId).toBe(b);

    await drive.trash(alice, shareId, b);
    expect(
      await reason(
        drive.createFolder(alice, shareId, {
          nodeId: UUIDv7(),
          parentId: b,
          keyGeneration: 1,
          nodeKey: nodeKey(),
          meta: meta(),
          signature: b64(64),
        }),
      ),
    ).toEqual({ code: "CONFLICT", reason: "drive_invalid_parent" });
  });

  it("deletes permanently only from the trash, subtree and blocks included", async () => {
    await drive.enroll(alice, "alice@thesomnus.com", enrollBody());
    const { shareId, rootId } = await newShare(alice);
    const folderId = UUIDv7();
    await drive.createFolder(alice, shareId, {
      nodeId: folderId,
      parentId: rootId,
      keyGeneration: 1,
      nodeKey: nodeKey(),
      meta: meta(),
      signature: b64(64),
    });
    await uploadFile({ actor: alice, shareId, parentId: folderId, blocks: 2 });

    expect(await reason(drive.purgeNode(alice, shareId, folderId))).toEqual({
      code: "CONFLICT",
      reason: "drive_not_trashed",
    });
    expect(await reason(drive.trash(alice, shareId, rootId))).toEqual({
      code: "CONFLICT",
      reason: "drive_root_node",
    });
    const trashed = await drive.trash(alice, shareId, folderId);
    expect(trashed.trashedAt).not.toBeNull();
    expect((await drive.restore(alice, shareId, folderId)).trashedAt).toBeNull();
    await drive.trash(alice, shareId, folderId);

    expect(await drive.purgeNode(alice, shareId, folderId)).toEqual({ purged: 2 });
    expect((await drive.shareDetail(alice, shareId)).nodes.map((n) => n.id)).toEqual([rootId]);
    const blocks = await db.execute(sql`SELECT COUNT(*) AS n FROM drive_blocks`);
    expect((blocks[0] as unknown as Array<{ n: number }>)[0]?.n).toBe(0);
  });
});

describe("resetting lost keys", () => {
  it("drops the person's folders, deletes the ones nobody else can open, and never leaves one ownerless", async () => {
    await enrollAll();
    const solo = await newShare(alice);
    const shared = await newShare(alice);
    await drive.addMember(alice, shared.shareId, {
      userId: bob,
      role: "viewer",
      keyGeneration: 1,
      memberKey: memberKey(),
    });

    const account = await drive.reset(alice, "alice@thesomnus.com", enrollBody());
    expect(account.keyVersion).toBe(2);
    expect(account.state).toBeNull();

    expect((await drive.listShares(alice)).shares).toHaveLength(0);
    expect(await repo.findShare(solo.shareId)).toBeNull();
    const bobShares = await drive.listShares(bob);
    expect(bobShares.shares.map((s) => s.shareId)).toEqual([shared.shareId]);
    expect(bobShares.shares[0]?.role).toBe("owner");
  });
});

describe("migrations", () => {
  it("go down and up again cleanly", async () => {
    await runDriveMigrationsDown(pool);
    const [tables] = await pool.query("SHOW TABLES LIKE 'drive_%'");
    expect(tables).toHaveLength(0);
    await runDriveMigrationsUp(db);
    const [again] = await pool.query("SHOW TABLES LIKE 'drive_%'");
    expect(again).toHaveLength(6);
  });
});
