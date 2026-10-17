import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { UUIDv7 } from "@somnus/api-contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { DriveService } from "../src/modules/drive/drive.service.js";

/**
 * The Drive's internal HTTP surface (ADR 0019), with the service stubbed: what
 * is under test is the controller's refusals -- no acting user, malformed ids,
 * out-of-range blocks -- and that the bytes of a block reach the service intact.
 * The service's own rules are proven against MySQL in test/integration.
 */
const ACTOR = UUIDv7();
const SHARE = UUIDv7();
const NODE = UUIDv7();

type Call = { method: string; args: unknown[] };

describe("drive controller (e2e)", () => {
  let app: NestFastifyApplication;
  const calls: Call[] = [];

  // Explicit methods, not a Proxy: a Proxy also answers `then`, and Nest would
  // await the provider as a promise that never settles.
  const record =
    (method: string, result: unknown = {}) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return result;
    };
  const stub = Object.fromEntries(
    [
      "account",
      "enroll",
      "rewrap",
      "saveState",
      "reset",
      "erase",
      "directory",
      "listShares",
      "createShare",
      "shareDetail",
      "purgeShare",
      "addMember",
      "acceptKey",
      "setRole",
      "removeMember",
      "createFolder",
      "startUpload",
      "putBlock",
      "commit",
      "rename",
      "move",
      "trash",
      "restore",
      "purgeNode",
    ].map((method) => [method, record(method)]),
  );
  stub["readBlock"] = record("readBlock", { data: "AAEC" });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DriveService)
      .useValue(stub)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  it("refuses a request with no acting user before the service is asked anything", async () => {
    const res = await app.inject({ method: "GET", url: "/internal/v1/drive/shares" });
    expect(res.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses an acting user id that is not an opaque id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/internal/v1/drive/shares",
      headers: { "x-somnus-actor-id": "1 OR 1=1" },
    });
    expect(res.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("passes the acting user through", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/internal/v1/drive/shares",
      headers: { "x-somnus-actor-id": ACTOR },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([{ method: "listShares", args: [ACTOR] }]);
  });

  it("enrollment needs the session's email, which only edge-api supplies", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/v1/drive/account",
      headers: { "x-somnus-actor-id": ACTOR },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses a malformed folder id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/internal/v1/drive/shares/not-an-id",
      headers: { "x-somnus-actor-id": ACTOR },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses a block index beyond the file size limit", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/internal/v1/drive/shares/${SHARE}/nodes/${NODE}/revisions/1/blocks/40`,
      headers: { "x-somnus-actor-id": ACTOR },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a revision that is not a plain positive integer", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/internal/v1/drive/shares/${SHARE}/nodes/${NODE}/revisions/1e3/blocks/0`,
      headers: { "x-somnus-actor-id": ACTOR },
    });
    expect(res.statusCode).toBe(400);
  });

  it("hands the service the exact bytes of an uploaded block", async () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252]);
    const res = await app.inject({
      method: "PUT",
      url: `/internal/v1/drive/shares/${SHARE}/nodes/${NODE}/revisions/2/blocks/3`,
      headers: { "x-somnus-actor-id": ACTOR },
      payload: { data: bytes.toString("base64") },
    });
    expect(res.statusCode).toBe(204);
    const call = calls[0] as Call;
    expect(call.method).toBe("putBlock");
    const input = call.args[0] as { data: Buffer; revision: number; blockIndex: number };
    expect(Buffer.compare(input.data, bytes)).toBe(0);
    expect(input.revision).toBe(2);
    expect(input.blockIndex).toBe(3);
  });

  it("refuses a block body that is not base64", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/internal/v1/drive/shares/${SHARE}/nodes/${NODE}/revisions/1/blocks/0`,
      headers: { "x-somnus-actor-id": ACTOR },
      payload: { data: "<not base64>" },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  /**
   * Every route reaches exactly the service method it names, with the acting
   * user first. Bodies are not validated by the stub, so each one here is the
   * smallest the contract accepts -- a 400 would mean the route never got there.
   */
  describe("every route reaches its service method", () => {
    const b64 = (n: number) => Buffer.alloc(n, 1).toString("base64");
    const memberKey = { ephemeralPublicKey: b64(91), iv: b64(12), ct: b64(48), signature: b64(64) };
    const meta = { iv: b64(12), ct: b64(40) };
    const enroll = {
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
    };
    const other = UUIDv7();
    const node = `/internal/v1/drive/shares/${SHARE}/nodes/${NODE}`;
    const cases: Array<{
      method: "GET" | "POST" | "PUT";
      url: string;
      body?: unknown;
      calls: string;
    }> = [
      { method: "GET", url: "/internal/v1/drive/account", calls: "account" },
      { method: "POST", url: "/internal/v1/drive/account", body: enroll, calls: "enroll" },
      {
        method: "POST",
        url: "/internal/v1/drive/account/rewrap",
        body: { passphraseWrap: enroll.passphraseWrap },
        calls: "rewrap",
      },
      {
        method: "POST",
        url: "/internal/v1/drive/account/state",
        body: { state: { iv: b64(12), ct: b64(64) } },
        calls: "saveState",
      },
      { method: "POST", url: "/internal/v1/drive/account/reset", body: enroll, calls: "reset" },
      { method: "POST", url: "/internal/v1/drive/account/erase", calls: "erase" },
      { method: "GET", url: "/internal/v1/drive/directory", calls: "directory" },
      { method: "GET", url: "/internal/v1/drive/shares", calls: "listShares" },
      {
        method: "POST",
        url: "/internal/v1/drive/shares",
        body: {
          shareId: SHARE,
          root: { nodeId: NODE, nodeKey: { iv: b64(12), ct: b64(48) }, meta, signature: b64(64) },
          ownerKey: memberKey,
        },
        calls: "createShare",
      },
      { method: "GET", url: `/internal/v1/drive/shares/${SHARE}`, calls: "shareDetail" },
      { method: "POST", url: `/internal/v1/drive/shares/${SHARE}/purge`, calls: "purgeShare" },
      {
        method: "POST",
        url: `/internal/v1/drive/shares/${SHARE}/access`,
        body: { userId: other, role: "viewer", keyGeneration: 1, memberKey },
        calls: "addMember",
      },
      {
        method: "POST",
        url: `/internal/v1/drive/shares/${SHARE}/accept`,
        body: { keyGeneration: 1, memberKey },
        calls: "acceptKey",
      },
      {
        method: "POST",
        url: `/internal/v1/drive/shares/${SHARE}/access/${other}/role`,
        body: { role: "editor" },
        calls: "setRole",
      },
      {
        method: "POST",
        url: `/internal/v1/drive/shares/${SHARE}/access/${other}/remove`,
        body: { keyGeneration: 2, memberKeys: [], nodeKeys: [] },
        calls: "removeMember",
      },
      {
        method: "POST",
        url: `/internal/v1/drive/shares/${SHARE}/folders`,
        body: {
          nodeId: other,
          parentId: NODE,
          keyGeneration: 1,
          nodeKey: { iv: b64(12), ct: b64(48) },
          meta,
          signature: b64(64),
        },
        calls: "createFolder",
      },
      {
        method: "POST",
        url: `/internal/v1/drive/shares/${SHARE}/uploads`,
        body: {
          nodeId: NODE,
          revision: 2,
          blockCount: 1,
          sizeBytes: 100,
          contentHash: b64(32),
          meta,
          signature: b64(64),
        },
        calls: "startUpload",
      },
      { method: "POST", url: `${node}/revisions/2/commit`, calls: "commit" },
      { method: "GET", url: `${node}/revisions/2/blocks/0`, calls: "readBlock" },
      {
        method: "POST",
        url: `${node}/rename`,
        body: { meta, signature: b64(64) },
        calls: "rename",
      },
      { method: "POST", url: `${node}/move`, body: { parentId: other }, calls: "move" },
      { method: "POST", url: `${node}/trash`, calls: "trash" },
      { method: "POST", url: `${node}/restore`, calls: "restore" },
      { method: "POST", url: `${node}/purge`, calls: "purgeNode" },
    ];

    it.each(cases)("$method $url -> $calls", async ({ method, url, body, calls: expected }) => {
      const res = await app.inject({
        method,
        url,
        headers: { "x-somnus-actor-id": ACTOR, "x-somnus-actor-email": "staff@thesomnus.com" },
        ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
      });
      expect(res.statusCode, res.body).toBeLessThan(300);
      expect(calls.map((c) => c.method)).toEqual([expected]);
      const first = (calls[0] as Call).args[0];
      expect(typeof first === "string" ? first : (first as { actorId: string }).actorId).toBe(
        ACTOR,
      );
    });
  });
});
