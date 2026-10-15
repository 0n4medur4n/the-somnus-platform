import { createHash } from "node:crypto";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { UUIDv7 } from "@somnus/api-contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { ACTOR_ID_HEADER } from "../../src/common/decorators/current-actor.decorator.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import { resetConsentTables } from "./consent-db-test-helper.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

type JsonResponse = { statusCode: number; body: unknown };

async function inject(
  server: FastifyInstance,
  method: string,
  url: string,
  options: { actorId?: string; payload?: unknown } = {},
): Promise<JsonResponse> {
  const res = await server.inject({
    method,
    url,
    headers: {
      ...(options.actorId ? { [ACTOR_ID_HEADER]: options.actorId } : {}),
      ...(options.payload !== undefined ? { "content-type": "application/json" } : {}),
    },
    payload: options.payload !== undefined ? JSON.stringify(options.payload) : undefined,
  });
  const body = res.body.length > 0 ? res.json() : undefined;
  return { statusCode: res.statusCode, body };
}

describe("consent HTTP endpoints (build plan §20 Checkpoint 7.1)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  const users = new UsersRepository(getTestDb());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTables();
    await resetConsentTables();
  });

  describe("GET /v1/legal-documents/current", () => {
    it("is readable with no actor header at all", async () => {
      const res = await inject(server, "GET", "/v1/legal-documents/current");
      expect(res.statusCode).toBe(200);
      const documents = (res.body as { documents: Array<{ purposeKey: string }> }).documents;
      expect(documents).toHaveLength(6);
    });

    it("respects a ?locale= query parameter", async () => {
      // Only "es" content is seeded by migration; other test files
      // (consent-repositories.test.ts) legitimately publish "en"
      // versions for their own scenarios against this same persistent
      // database (CI never resets legal_document_versions between
      // runs), so this asserts the endpoint actually filters by
      // locale -- never every returned row has that locale -- rather
      // than a document count, which isn't stable across test runs.
      const res = await inject(server, "GET", "/v1/legal-documents/current?locale=en");
      expect(res.statusCode).toBe(200);
      const documents = (res.body as { documents: Array<{ locale: string }> }).documents;
      expect(documents.every((d) => d.locale === "en")).toBe(true);

      const esRes = await inject(server, "GET", "/v1/legal-documents/current?locale=es");
      const esDocuments = (esRes.body as { documents: Array<{ locale: string }> }).documents;
      expect(esDocuments).toHaveLength(6);
    });
  });

  describe("the signed copy: fingerprints and GET /v1/consents/receipts", () => {
    it("serves every document with its title and the SHA-256 of its exact text", async () => {
      const res = await inject(server, "GET", "/v1/legal-documents/current?locale=es");
      const documents = (
        res.body as {
          documents: Array<{ title: string; content: string; contentSha256: string }>;
        }
      ).documents;
      expect(documents.length).toBeGreaterThan(0);
      for (const document of documents) {
        expect(document.title.length).toBeGreaterThan(0);
        expect(document.contentSha256).toBe(
          createHash("sha256").update(document.content, "utf8").digest("hex"),
        );
      }
    });

    it("lists each consent with the exact document version it was given against, newest first, withdrawn ones kept", async () => {
      const userId = await users.create({ email: "signed-copy@example.com" });
      const health = await inject(server, "POST", "/v1/consents", {
        actorId: userId,
        payload: { purposeKey: "health_data_processing", source: "morpheo-assessment" },
      });
      const marketing = await inject(server, "POST", "/v1/consents", {
        actorId: userId,
        payload: { purposeKey: "marketing" },
      });
      const marketingId = (marketing.body as { id: string }).id;
      await inject(server, "POST", `/v1/consents/${marketingId}/withdraw`, {
        actorId: userId,
        payload: {},
      });

      const res = await inject(server, "GET", "/v1/consents/receipts", { actorId: userId });
      expect(res.statusCode).toBe(200);
      const receipts = (
        res.body as {
          receipts: Array<{
            receiptId: string;
            purposeKey: string;
            source: string;
            withdrawnAt?: string;
            document: { id: string; content: string; contentSha256: string; locale: string };
          }>;
        }
      ).receipts;
      expect(receipts.map((r) => r.receiptId)).toEqual([
        marketingId,
        (health.body as { id: string }).id,
      ]);
      expect(receipts[0]?.withdrawnAt).toBeTruthy();
      const healthRecord = receipts[1];
      expect(healthRecord?.purposeKey).toBe("health_data_processing");
      expect(healthRecord?.source).toBe("morpheo-assessment");
      expect(healthRecord?.withdrawnAt).toBeUndefined();
      expect(healthRecord?.document.locale).toBe("es");
      expect(healthRecord?.document.id).toBe(
        (health.body as { legalDocumentVersionId: string }).legalDocumentVersionId,
      );
      expect(healthRecord?.document.contentSha256).toBe(
        createHash("sha256")
          .update(healthRecord?.document.content ?? "", "utf8")
          .digest("hex"),
      );
    });

    it("never lists another person's consents", async () => {
      const someone = await users.create({ email: "someone@example.com" });
      const other = await users.create({ email: "other@example.com" });
      await inject(server, "POST", "/v1/consents", {
        actorId: someone,
        payload: { purposeKey: "marketing" },
      });
      const res = await inject(server, "GET", "/v1/consents/receipts", { actorId: other });
      expect((res.body as { receipts: unknown[] }).receipts).toEqual([]);
    });
  });

  describe("POST /v1/consents -> GET /v1/consents/current -> POST /:id/withdraw", () => {
    it("full lifecycle: grant, see it reflected, withdraw, see it reflected immediately", async () => {
      const userId = await users.create({ email: "consent-lifecycle@example.com" });

      const createRes = await inject(server, "POST", "/v1/consents", {
        actorId: userId,
        payload: { purposeKey: "marketing" },
      });
      expect(createRes.statusCode).toBe(201);
      const receiptId = (createRes.body as { id: string }).id;
      expect(receiptId).toBeTruthy();

      const statusRes = await inject(server, "GET", "/v1/consents/current", { actorId: userId });
      const marketing = (
        statusRes.body as { purposes: Array<{ purposeKey: string; consented: boolean }> }
      ).purposes.find((p) => p.purposeKey === "marketing");
      expect(marketing?.consented).toBe(true);

      const withdrawRes = await inject(server, "POST", `/v1/consents/${receiptId}/withdraw`, {
        actorId: userId,
        payload: {},
      });
      expect(withdrawRes.statusCode).toBe(204);

      // Immediately, same request cycle, no delay -- reflects the withdrawal.
      const afterRes = await inject(server, "GET", "/v1/consents/current", { actorId: userId });
      const marketingAfter = (
        afterRes.body as {
          purposes: Array<{ purposeKey: string; consented: boolean; withdrawn: boolean }>;
        }
      ).purposes.find((p) => p.purposeKey === "marketing");
      expect(marketingAfter?.consented).toBe(false);
      expect(marketingAfter?.withdrawn).toBe(true);
    });

    it("404s withdrawing a receipt that does not exist", async () => {
      const userId = await users.create({ email: "consent-404@example.com" });
      const res = await inject(server, "POST", `/v1/consents/${UUIDv7()}/withdraw`, {
        actorId: userId,
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /internal/v1/consents/check", () => {
    it("returns consented=false, withdrawn=false for a user who never consented", async () => {
      const userId = await users.create({ email: "consent-check-none@example.com" });
      const res = await inject(server, "POST", "/internal/v1/consents/check", {
        payload: { userId, purposeKey: "health_data_processing" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ consented: false, withdrawn: false });
    });
  });

  describe("cross-module: authorization reflects a consent withdrawal immediately", () => {
    it("self-access to clinical data is denied with DENIED_CONSENT_WITHDRAWN right after withdrawal, no delay", async () => {
      const userId = await users.create({ email: "consent-authz@example.com" });

      const createRes = await inject(server, "POST", "/v1/consents", {
        actorId: userId,
        payload: { purposeKey: "health_data_processing" },
      });
      const receiptId = (createRes.body as { id: string }).id;

      const beforeAuthz = await inject(server, "POST", "/internal/v1/authorization/check", {
        payload: { actorUserId: userId, subjectUserId: userId, action: "read_clinical_data" },
      });
      expect(beforeAuthz.body).toMatchObject({
        allowed: true,
        reasonCode: "AUTHORIZED_SELF_ACCESS",
      });

      await inject(server, "POST", `/v1/consents/${receiptId}/withdraw`, {
        actorId: userId,
        payload: {},
      });

      const afterAuthz = await inject(server, "POST", "/internal/v1/authorization/check", {
        payload: { actorUserId: userId, subjectUserId: userId, action: "read_clinical_data" },
      });
      expect(afterAuthz.body).toMatchObject({
        allowed: false,
        reasonCode: "DENIED_CONSENT_WITHDRAWN",
      });
    });

    it("a user who never consented is unaffected -- absence of consent is not treated as withdrawn", async () => {
      const userId = await users.create({ email: "consent-authz-none@example.com" });
      const res = await inject(server, "POST", "/internal/v1/authorization/check", {
        payload: { actorUserId: userId, subjectUserId: userId, action: "read_clinical_data" },
      });
      expect(res.body).toMatchObject({ allowed: true, reasonCode: "AUTHORIZED_SELF_ACCESS" });
    });
  });
});
