import type { Storage } from "@google-cloud/storage";
import { describe, expect, it } from "vitest";
import {
  createObjectStore,
  GcsObjectStore,
  MemoryObjectStore,
  MUST_NOT_EXIST,
  PreconditionFailed,
  UnconfiguredObjectStore,
} from "../src/modules/drive/storage/object-store.js";

/**
 * The compare-and-swap the Drive's consistency rests on (ADR 0019): a write
 * conditional on the object's current generation. The in-memory store must
 * honour it exactly as Cloud Storage does, or the service tests prove nothing;
 * the GCS store must translate it into the SDK's precondition options.
 */
describe("MemoryObjectStore", () => {
  it("creates only when told the object must not exist yet, and only once", async () => {
    const store = new MemoryObjectStore();
    await store.put("a", Buffer.from("1"), { ifGeneration: MUST_NOT_EXIST });
    await expect(
      store.put("a", Buffer.from("2"), { ifGeneration: MUST_NOT_EXIST }),
    ).rejects.toBeInstanceOf(PreconditionFailed);
    expect((await store.get("a"))?.data.toString()).toBe("1");
  });

  it("replaces only at the generation that was read", async () => {
    const store = new MemoryObjectStore();
    await store.put("a", Buffer.from("1"));
    const first = await store.get("a");
    await store.put("a", Buffer.from("2"), { ifGeneration: first?.generation ?? "" });
    await expect(
      store.put("a", Buffer.from("3"), { ifGeneration: first?.generation ?? "" }),
    ).rejects.toBeInstanceOf(PreconditionFailed);
    expect((await store.get("a"))?.data.toString()).toBe("2");
  });

  it("lists by prefix with sizes, and deletes idempotently", async () => {
    const store = new MemoryObjectStore();
    await store.put("x/1", Buffer.alloc(3));
    await store.put("x/2", Buffer.alloc(5));
    await store.put("y/1", Buffer.alloc(1));
    expect(await store.list("x/")).toEqual([
      { name: "x/1", size: 3 },
      { name: "x/2", size: 5 },
    ]);
    await store.delete("x/1");
    await store.delete("x/1");
    expect(store.names()).toEqual(["x/2", "y/1"]);
    expect(await store.get("missing")).toBeNull();
  });
});

/** A stand-in for the SDK's Bucket, recording the options the store passes. */
function fakeStorage(behaviour: { getStatus?: number; saveStatus?: number } = {}) {
  const calls: Array<{ op: string; name: string; options?: unknown }> = [];
  const fail = (code: number) => Object.assign(new Error(`status ${code}`), { code });
  const file = (name: string, options?: unknown) => ({
    getMetadata: async () => {
      calls.push({ op: "getMetadata", name });
      if (behaviour.getStatus) throw fail(behaviour.getStatus);
      return [{ generation: "42" }];
    },
    download: async () => {
      calls.push({ op: "download", name, options });
      return [Buffer.from("payload")];
    },
    save: async (_data: Buffer, saveOptions: unknown) => {
      calls.push({ op: "save", name, options: saveOptions });
      if (behaviour.saveStatus) throw fail(behaviour.saveStatus);
    },
    delete: async (deleteOptions: unknown) => {
      calls.push({ op: "delete", name, options: deleteOptions });
    },
  });
  const bucket = {
    file,
    getFiles: async (options: unknown) => {
      calls.push({ op: "getFiles", name: "", options });
      return [[{ name: "p/a", metadata: { size: "7" } }]];
    },
  };
  return { storage: { bucket: () => bucket } as unknown as Storage, calls };
}

describe("GcsObjectStore", () => {
  it("reads the exact generation it saw, so data and generation agree", async () => {
    const { storage, calls } = fakeStorage();
    const store = new GcsObjectStore("drive-bucket", storage);
    expect(await store.get("a")).toEqual({ data: Buffer.from("payload"), generation: "42" });
    expect(calls).toContainEqual({ op: "download", name: "a", options: { generation: "42" } });
  });

  it("maps a 404 to null and a 412 to PreconditionFailed", async () => {
    expect(
      await new GcsObjectStore("b", fakeStorage({ getStatus: 404 }).storage).get("a"),
    ).toBeNull();
    await expect(
      new GcsObjectStore("b", fakeStorage({ getStatus: 500 }).storage).get("a"),
    ).rejects.toThrow("status 500");
    await expect(
      new GcsObjectStore("b", fakeStorage({ saveStatus: 412 }).storage).put("a", Buffer.alloc(1), {
        ifGeneration: "42",
      }),
    ).rejects.toBeInstanceOf(PreconditionFailed);
    await expect(
      new GcsObjectStore("b", fakeStorage({ saveStatus: 503 }).storage).put("a", Buffer.alloc(1)),
    ).rejects.toThrow("status 503");
  });

  it("passes the generation as the SDK's ifGenerationMatch, and nothing when unconditional", async () => {
    const { storage, calls } = fakeStorage();
    const store = new GcsObjectStore("b", storage);
    await store.put("a", Buffer.alloc(1), { ifGeneration: MUST_NOT_EXIST });
    await store.put("c", Buffer.alloc(1));
    const saves = calls.filter((c) => c.op === "save");
    expect(saves[0]?.options).toMatchObject({
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    expect(saves[1]?.options).not.toHaveProperty("preconditionOpts");
  });

  it("lists with sizes and deletes ignoring a missing object", async () => {
    const { storage, calls } = fakeStorage();
    const store = new GcsObjectStore("b", storage);
    expect(await store.list("p/")).toEqual([{ name: "p/a", size: 7 }]);
    await store.delete("p/a");
    expect(calls).toContainEqual({ op: "delete", name: "p/a", options: { ignoreNotFound: true } });
  });
});

describe("createObjectStore", () => {
  it("uses the bucket when configured, memory in development, and refuses in production", async () => {
    expect(createObjectStore("drive-bucket", "production")).toBeInstanceOf(GcsObjectStore);
    expect(createObjectStore(undefined, "development")).toBeInstanceOf(MemoryObjectStore);
    const refusing = createObjectStore(undefined, "production");
    expect(refusing).toBeInstanceOf(UnconfiguredObjectStore);
    expect(refusing.configured).toBe(false);
    for (const op of [
      () => refusing.get("a"),
      () => refusing.put("a", Buffer.alloc(1)),
      () => refusing.delete("a"),
      () => refusing.list("a"),
    ]) {
      await expect(op()).rejects.toMatchObject({ code: "CONFIGURATION_INVALID" });
    }
  });
});
