import { describe, expect, it, vi } from "vitest";
import type { ConsentProxyService } from "../../src/modules/consent/consent.service.js";
import { ConsentsController } from "../../src/modules/consent/consents.controller.js";
import { LegalDocumentsController } from "../../src/modules/consent/legal-documents.controller.js";
import { MeController } from "../../src/modules/me/me.controller.js";
import type { MeService } from "../../src/modules/me/me.service.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";

const SESSION = {
  sessionId: "s1",
  firebaseUid: "f1",
  somnusUserId: "a1",
} as unknown as SessionRecord;

describe("MeController delegation", () => {
  it("getMe delegates to MeService with the session and correlation id", async () => {
    const me = { getMe: vi.fn().mockResolvedValue({ ok: true }), patchProfile: vi.fn() };
    const controller = new MeController(me as unknown as MeService);

    await controller.getMe(SESSION, "corr-1");
    expect(me.getMe).toHaveBeenCalledWith(SESSION, "corr-1");
  });

  it("patchProfile delegates to MeService with the body", async () => {
    const me = { getMe: vi.fn(), patchProfile: vi.fn().mockResolvedValue(undefined) };
    const controller = new MeController(me as unknown as MeService);

    await controller.patchProfile(SESSION, { firstName: "Ada" }, "corr-1");
    expect(me.patchProfile).toHaveBeenCalledWith(SESSION, { firstName: "Ada" }, "corr-1");
  });
});

describe("ConsentsController delegation", () => {
  const service = () => ({
    record: vi.fn().mockResolvedValue({ id: "r1" }),
    getCurrent: vi.fn().mockResolvedValue({ purposes: [] }),
    withdraw: vi.fn().mockResolvedValue(undefined),
  });

  it("create delegates to record", async () => {
    const s = service();
    const controller = new ConsentsController(s as unknown as ConsentProxyService);
    await controller.create(SESSION, { purposeKey: "health_data_processing", source: "app" }, "c");
    expect(s.record).toHaveBeenCalledWith(
      SESSION,
      { purposeKey: "health_data_processing", source: "app" },
      "c",
    );
  });

  it("current delegates to getCurrent", async () => {
    const s = service();
    const controller = new ConsentsController(s as unknown as ConsentProxyService);
    await controller.current(SESSION, "c");
    expect(s.getCurrent).toHaveBeenCalledWith(SESSION, "c");
  });

  it("withdraw delegates to withdraw with the receipt id", async () => {
    const s = service();
    const controller = new ConsentsController(s as unknown as ConsentProxyService);
    await controller.withdraw(SESSION, "receipt-1", { reason: "x" }, "c");
    expect(s.withdraw).toHaveBeenCalledWith(SESSION, "receipt-1", { reason: "x" }, "c");
  });
});

describe("LegalDocumentsController delegation", () => {
  it("current delegates to getLegalDocuments with the locale", async () => {
    const s = { getLegalDocuments: vi.fn().mockResolvedValue({ documents: [] }) };
    const controller = new LegalDocumentsController(s as unknown as ConsentProxyService);
    await controller.current("ca", "c");
    expect(s.getLegalDocuments).toHaveBeenCalledWith("ca", "c");
  });
});
