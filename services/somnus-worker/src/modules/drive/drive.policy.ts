import type { DriveErrorReason, DriveRole } from "@somnus/api-contracts";
import { ErrorCode, type ErrorCodeType, SomnusError } from "@somnus/errors";

/**
 * The staff Drive's server-side rules (ADR 0019), as pure functions.
 *
 * The server cannot read anything in the Drive, so these rules are about who
 * may ASK for what: who may fetch a folder's ciphertext, who may add to it, who
 * may hand its key to someone else. Confidentiality itself does not depend on
 * them -- a person without the folder key reads nothing whatever this file says
 * -- but integrity and availability do: a viewer must not be able to replace a
 * protocol, and nobody may leave a folder ownerless.
 */

const RANK: Readonly<Record<DriveRole, number>> = { viewer: 0, editor: 1, owner: 2 };

/** Every Drive refusal: one of the platform's error codes, plus a stable reason. */
export function driveError(
  code: ErrorCodeType,
  reason: DriveErrorReason,
  message = "The Drive refused this request.",
): SomnusError {
  // The exception filter answers with the request's own correlation id; this
  // one only labels the error if it is ever logged outside a request.
  return new SomnusError(code, message, { correlationId: "drive", details: { reason } });
}

/** Membership first, then rank. A non-member is told only that the folder is not theirs. */
export function requireRole(role: DriveRole | null, minimum: DriveRole): DriveRole {
  if (role === null) throw driveError(ErrorCode.NOT_FOUND, "drive_not_a_member");
  if (RANK[role] < RANK[minimum]) throw driveError(ErrorCode.FORBIDDEN, "drive_role_insufficient");
  return role;
}

export type TreeNode = { id: string; parentId: string | null; kind: string };

/** `nodeId` and everything beneath it. Cycles cannot occur, but a cycle cannot hang this either. */
export function subtreeIds(nodes: ReadonlyArray<TreeNode>, nodeId: string): string[] {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node.id);
    children.set(node.parentId, list);
  }
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return [...seen];
}

/** A move may not put a folder inside itself or inside its own descendants. */
export function isValidMoveTarget(
  nodes: ReadonlyArray<TreeNode>,
  nodeId: string,
  targetParentId: string,
): boolean {
  return !subtreeIds(nodes, nodeId).includes(targetParentId);
}

/**
 * A rotation is complete when it wraps the new key for EXACTLY the members who
 * remain and rewraps EXACTLY the folder's nodes -- no one left out (they would
 * lose access silently), nobody added (that is what adding a member is for), and
 * no node left under the old key (the removed person could still open it).
 */
export function isCompleteRotation(input: {
  remainingMemberIds: ReadonlyArray<string>;
  nodeIds: ReadonlyArray<string>;
  wrappedForMemberIds: ReadonlyArray<string>;
  rewrappedNodeIds: ReadonlyArray<string>;
}): boolean {
  return (
    sameSet(input.remainingMemberIds, input.wrappedForMemberIds) &&
    sameSet(input.nodeIds, input.rewrappedNodeIds)
  );
}

function sameSet(expected: ReadonlyArray<string>, actual: ReadonlyArray<string>): boolean {
  const unique = new Set(actual);
  if (unique.size !== actual.length) return false;
  if (unique.size !== new Set(expected).size) return false;
  return expected.every((id) => unique.has(id));
}

/**
 * Whether removing `targetUserId` (or demoting them) would leave the folder with
 * no owner. A folder whose last owner leaves cannot be shared or cleaned up by
 * anyone, so the server refuses it and asks for another owner first.
 */
export function wouldLeaveNoOwner(
  members: ReadonlyArray<{ userId: string; role: DriveRole }>,
  targetUserId: string,
): boolean {
  const otherOwners = members.filter((m) => m.role === "owner" && m.userId !== targetUserId);
  return otherOwners.length === 0;
}

/**
 * Upload completeness: every block index from 0 to `blockCount - 1` present
 * once, and their sizes adding up to what the uploader declared and signed.
 */
export function isCompleteUpload(
  declared: { blockCount: number; sizeBytes: number },
  blocks: ReadonlyArray<{ blockIndex: number; sizeBytes: number }>,
): boolean {
  if (blocks.length !== declared.blockCount) return false;
  const indexes = new Set(blocks.map((b) => b.blockIndex));
  for (let i = 0; i < declared.blockCount; i += 1) {
    if (!indexes.has(i)) return false;
  }
  const total = blocks.reduce((sum, b) => sum + b.sizeBytes, 0);
  return total === declared.sizeBytes;
}
