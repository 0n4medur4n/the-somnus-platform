import { SomnusError } from "@somnus/errors";
import { describe, expect, it } from "vitest";
import {
  isCompleteRotation,
  isCompleteUpload,
  isValidMoveTarget,
  requireRole,
  subtreeIds,
  wouldLeaveNoOwner,
} from "../src/modules/drive/drive.policy.js";

function reasonOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    if (error instanceof SomnusError) return { code: error.code, reason: error.details["reason"] };
    throw error;
  }
  return null;
}

describe("requireRole (negative first)", () => {
  it("a non-member is told only that the folder is not found", () => {
    expect(reasonOf(() => requireRole(null, "viewer"))).toEqual({
      code: "NOT_FOUND",
      reason: "drive_not_a_member",
    });
  });

  it("a viewer cannot edit, and an editor cannot manage", () => {
    expect(reasonOf(() => requireRole("viewer", "editor"))).toEqual({
      code: "FORBIDDEN",
      reason: "drive_role_insufficient",
    });
    expect(reasonOf(() => requireRole("editor", "owner"))).toEqual({
      code: "FORBIDDEN",
      reason: "drive_role_insufficient",
    });
  });

  it("each role reaches its own rank and everything below it", () => {
    expect(requireRole("viewer", "viewer")).toBe("viewer");
    expect(requireRole("editor", "viewer")).toBe("editor");
    expect(requireRole("owner", "editor")).toBe("owner");
    expect(requireRole("owner", "owner")).toBe("owner");
  });
});

const TREE = [
  { id: "root", parentId: null, kind: "folder" },
  { id: "a", parentId: "root", kind: "folder" },
  { id: "a1", parentId: "a", kind: "folder" },
  { id: "a1f", parentId: "a1", kind: "file" },
  { id: "b", parentId: "root", kind: "folder" },
];

describe("tree rules", () => {
  it("a subtree is the node and everything beneath it", () => {
    expect(new Set(subtreeIds(TREE, "a"))).toEqual(new Set(["a", "a1", "a1f"]));
    expect(subtreeIds(TREE, "b")).toEqual(["b"]);
  });

  it("a folder cannot move into itself or its own descendants", () => {
    expect(isValidMoveTarget(TREE, "a", "a")).toBe(false);
    expect(isValidMoveTarget(TREE, "a", "a1")).toBe(false);
    expect(isValidMoveTarget(TREE, "a", "b")).toBe(true);
    expect(isValidMoveTarget(TREE, "a1f", "root")).toBe(true);
  });

  it("does not loop on a corrupted (cyclic) tree", () => {
    const cyclic = [
      { id: "x", parentId: "y", kind: "folder" },
      { id: "y", parentId: "x", kind: "folder" },
    ];
    expect(new Set(subtreeIds(cyclic, "x"))).toEqual(new Set(["x", "y"]));
  });
});

describe("key rotation must be complete", () => {
  const base = {
    remainingMemberIds: ["u1", "u2"],
    nodeIds: ["n1", "n2", "n3"],
    wrappedForMemberIds: ["u2", "u1"],
    rewrappedNodeIds: ["n3", "n1", "n2"],
  };

  it("accepts exactly the remaining members and exactly the folder's nodes", () => {
    expect(isCompleteRotation(base)).toBe(true);
  });

  it("refuses a rotation that leaves a member out (they would lose access silently)", () => {
    expect(isCompleteRotation({ ...base, wrappedForMemberIds: ["u1"] })).toBe(false);
  });

  it("refuses a rotation that slips in someone else (the removed person, for one)", () => {
    expect(isCompleteRotation({ ...base, wrappedForMemberIds: ["u1", "u2", "removed"] })).toBe(
      false,
    );
    expect(isCompleteRotation({ ...base, wrappedForMemberIds: ["u1", "removed"] })).toBe(false);
  });

  it("refuses a rotation that leaves a node under the old key", () => {
    expect(isCompleteRotation({ ...base, rewrappedNodeIds: ["n1", "n2"] })).toBe(false);
  });

  it("refuses duplicates that would make a short list look complete", () => {
    expect(isCompleteRotation({ ...base, rewrappedNodeIds: ["n1", "n1", "n2"] })).toBe(false);
  });
});

describe("a folder always keeps an owner", () => {
  it("removing or demoting the only owner would leave none", () => {
    const members = [
      { userId: "o", role: "owner" as const },
      { userId: "e", role: "editor" as const },
    ];
    expect(wouldLeaveNoOwner(members, "o")).toBe(true);
    expect(wouldLeaveNoOwner(members, "e")).toBe(false);
  });

  it("a second owner makes it safe", () => {
    const members = [
      { userId: "o1", role: "owner" as const },
      { userId: "o2", role: "owner" as const },
    ];
    expect(wouldLeaveNoOwner(members, "o1")).toBe(false);
  });
});

describe("an upload is complete only when every declared block is there", () => {
  const declared = { blockCount: 2, sizeBytes: 30 };

  it("accepts every index once and the declared total", () => {
    expect(
      isCompleteUpload(declared, [
        { blockIndex: 1, sizeBytes: 10 },
        { blockIndex: 0, sizeBytes: 20 },
      ]),
    ).toBe(true);
  });

  it("refuses a missing block, a wrong index, or a size that differs from what was signed", () => {
    expect(isCompleteUpload(declared, [{ blockIndex: 0, sizeBytes: 30 }])).toBe(false);
    expect(
      isCompleteUpload(declared, [
        { blockIndex: 0, sizeBytes: 15 },
        { blockIndex: 2, sizeBytes: 15 },
      ]),
    ).toBe(false);
    expect(
      isCompleteUpload(declared, [
        { blockIndex: 0, sizeBytes: 20 },
        { blockIndex: 1, sizeBytes: 11 },
      ]),
    ).toBe(false);
  });

  it("an empty file is zero blocks of zero bytes", () => {
    expect(isCompleteUpload({ blockCount: 0, sizeBytes: 0 }, [])).toBe(true);
  });
});
