import { describe, expect, it, vi } from "vitest";
import type { ConsentProxyService } from "../../src/modules/consent/consent.service.js";
import { ConsentsController } from "../../src/modules/consent/consents.controller.js";
import { LegalDocumentsController } from "../../src/modules/consent/legal-documents.controller.js";
import { MeController } from "../../src/modules/me/me.controller.js";
import type { MeService } from "../../src/modules/me/me.service.js";
import { InvitationsController } from "../../src/modules/organizations/invitations.controller.js";
import { OrganizationsController } from "../../src/modules/organizations/organizations.controller.js";
import type { OrganizationsProxyService } from "../../src/modules/organizations/organizations.service.js";
import { RegistrationController } from "../../src/modules/registration/registration.controller.js";
import type { RegistrationService } from "../../src/modules/registration/registration.service.js";
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

describe("RegistrationController delegation", () => {
  it("register delegates to RegistrationService with session and body", async () => {
    const s = { register: vi.fn().mockResolvedValue({ user: {} }) };
    const controller = new RegistrationController(s as unknown as RegistrationService);
    await controller.register(SESSION, { firstName: "Ada", lastName: "L" }, "c");
    expect(s.register).toHaveBeenCalledWith(SESSION, { firstName: "Ada", lastName: "L" }, "c");
  });
});

describe("OrganizationsController delegation", () => {
  const service = () => ({
    create: vi.fn().mockResolvedValue({ id: "o1" }),
    getById: vi.fn().mockResolvedValue({ id: "o1" }),
    listMembers: vi.fn().mockResolvedValue([]),
    invite: vi.fn().mockResolvedValue({ token: "t" }),
  });

  it("create delegates", async () => {
    const s = service();
    const c = new OrganizationsController(s as unknown as OrganizationsProxyService);
    await c.create(SESSION, { name: "Acme" }, "c");
    expect(s.create).toHaveBeenCalledWith(SESSION, { name: "Acme" }, "c");
  });

  it("getById delegates with the org id", async () => {
    const s = service();
    const c = new OrganizationsController(s as unknown as OrganizationsProxyService);
    await c.getById(SESSION, "org-1", "c");
    expect(s.getById).toHaveBeenCalledWith(SESSION, "org-1", "c");
  });

  it("listMembers delegates with the org id", async () => {
    const s = service();
    const c = new OrganizationsController(s as unknown as OrganizationsProxyService);
    await c.listMembers(SESSION, "org-1", "c");
    expect(s.listMembers).toHaveBeenCalledWith(SESSION, "org-1", "c");
  });

  it("invite delegates with the org id and body", async () => {
    const s = service();
    const c = new OrganizationsController(s as unknown as OrganizationsProxyService);
    await c.invite(SESSION, "org-1", { email: "i@example.com" }, "c");
    expect(s.invite).toHaveBeenCalledWith(SESSION, "org-1", { email: "i@example.com" }, "c");
  });
});

describe("InvitationsController delegation", () => {
  it("accept delegates with the token body", async () => {
    const s = { acceptInvitation: vi.fn().mockResolvedValue({ status: "accepted" }) };
    const c = new InvitationsController(s as unknown as OrganizationsProxyService);
    await c.accept(SESSION, { token: "tok" }, "c");
    expect(s.acceptInvitation).toHaveBeenCalledWith(SESSION, { token: "tok" }, "c");
  });
});
