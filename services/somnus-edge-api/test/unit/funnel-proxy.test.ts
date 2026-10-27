import { type FunnelState, UUIDv7 } from "@somnus/api-contracts";
import { describe, expect, it } from "vitest";
import { ACTOR_ID_HEADER } from "../../src/infrastructure/internal-clients/headers.js";
import { FunnelProxyService, withoutPanel } from "../../src/modules/funnel/funnel.service.js";
import type { ActorResolver } from "../../src/modules/sessions/actor-resolver.service.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";
import { makeFakeIdentityClient } from "../support/fake-identity.js";

const ACTOR = "018f0000-0000-7000-8000-000000000abc";
const SESSION = { sessionId: "s1", firebaseUid: "f1", somnusUserId: ACTOR } as SessionRecord;
const resolver = { resolve: async () => ACTOR } as unknown as ActorResolver;
const failingResolver = {
  resolve: async () => {
    throw new Error("no Somnus user");
  },
} as unknown as ActorResolver;

const { client: unusedReport } = makeFakeIdentityClient(() => ({ status: 500 }));

function state(): FunnelState {
  return {
    sessionId: "f-1",
    status: "open",
    step: {
      key: "AGE",
      questionId: "AGE",
      kind: "ask",
      type: "number",
      text: "¿Qué edad tiene?",
      note: null,
      options: [],
      fields: [],
      noneOption: false,
      unit: "años",
      units: [],
      allowAbsence: true,
      instrument: null,
      phase: "start",
      answeredCount: 0,
      extraction: null,
      panel: {
        reason: null,
        source: "AGE",
        branchesOpened: [],
        rulesFired: [],
        mainAction: null,
        phraseIds: [],
        instruments: [],
        ai: [],
      },
    },
    result: null,
    history: [],
    owned: false,
  };
}

function me(internalRoles: string[]) {
  return {
    user: { id: UUIDv7(), email: "u@example.com", locale: "es", status: "active" },
    individualProfile: null,
    professionalProfile: null,
    account: { registrationRole: null, internalRoles, organizations: [] },
  };
}

function setup(roles: string[], actorResolver: ActorResolver = resolver) {
  const morpheo = makeFakeIdentityClient(() => ({ status: 200, body: state() }));
  const identity = makeFakeIdentityClient((req) => {
    expect(req.path).toBe("/v1/me");
    expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
    return { status: 200, body: me(roles) };
  });
  return {
    morpheo,
    identity,
    service: new FunnelProxyService(morpheo.client, identity.client, actorResolver, unusedReport),
  };
}

describe("FunnelProxyService", () => {
  it("starts an anonymous interview with no actor and no panel", async () => {
    const { morpheo, identity, service } = setup(["platform_super_admin"]);
    const result = await service.create(undefined, { consentGiven: true }, true, "c1");
    expect(morpheo.requests[0]?.path).toBe("/internal/v1/funnel/sessions");
    expect(morpheo.requests[0]?.headers[ACTOR_ID_HEADER]).toBeUndefined();
    expect(result.step?.panel).toBeNull();
    expect(identity.requests).toHaveLength(0);
  });

  it("makes a signed-in person's interview theirs by forwarding the actor", async () => {
    const { morpheo, service } = setup([]);
    await service.create(SESSION, { consentGiven: true }, false, "c1");
    expect(morpheo.requests[0]?.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
  });

  it("never re-sends an interview answer: one stored twice reads as 'not the current step'", async () => {
    const morpheo = makeFakeIdentityClient(() => ({ status: 503, body: {} }));
    const identity = makeFakeIdentityClient(() => ({ status: 200, body: me([]) }));
    const service = new FunnelProxyService(morpheo.client, identity.client, resolver, unusedReport);
    await expect(
      service.answer(undefined, "f-1", { key: "AGE", value: 52 }, false, "c1"),
    ).rejects.toBeDefined();
    await expect(
      service.create(undefined, { consentGiven: true }, false, "c1"),
    ).rejects.toBeDefined();
    expect(morpheo.requests).toHaveLength(2);
  });

  it("forwards the answer to the step morpheo served, unchanged", async () => {
    const { morpheo, service } = setup([]);
    await service.answer(undefined, "f-1", { key: "AGE", value: 52 }, false, "c1");
    expect(morpheo.requests[0]?.path).toBe("/internal/v1/funnel/sessions/f-1/answers");
    expect(JSON.parse(morpheo.requests[0]?.body ?? "{}")).toEqual({ key: "AGE", value: 52 });
  });

  it("keeps the team panel only for an internal role that asked for it", async () => {
    const staff = setup(["platform_super_admin"]);
    expect((await staff.service.get(SESSION, "f-1", true, "c1")).step?.panel).not.toBeNull();

    const patient = setup([]);
    expect((await patient.service.get(SESSION, "f-1", true, "c1")).step?.panel).toBeNull();

    const notAsked = setup(["platform_super_admin"]);
    expect((await notAsked.service.get(SESSION, "f-1", false, "c1")).step?.panel).toBeNull();
    expect(notAsked.identity.requests).toHaveLength(0);
  });

  it("treats a session without a Somnus user as anonymous", async () => {
    const { morpheo, service } = setup(["platform_super_admin"], failingResolver);
    const result = await service.get(SESSION, "f-1", true, "c1");
    expect(morpheo.requests[0]?.headers[ACTOR_ID_HEADER]).toBeUndefined();
    expect(result.step?.panel).toBeNull();
  });

  it("refuses an unexpected morpheo response", async () => {
    const morpheo = makeFakeIdentityClient(() => ({ status: 200, body: { nope: true } }));
    const identity = makeFakeIdentityClient(() => ({ status: 200, body: me([]) }));
    const service = new FunnelProxyService(morpheo.client, identity.client, resolver, unusedReport);
    await expect(service.get(undefined, "f-1", false, "c1")).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  it("strips the panel from the result as well as the step", () => {
    const withResult: FunnelState = {
      ...state(),
      step: null,
      status: "finished",
      result: {
        stoppedBy: null,
        alerts: [],
        mainAction: "TERAPIA",
        associatedActions: [],
        testToConsider: null,
        texts: [{ template: "T_INSOMNIO", text: "Nos ha contado…" }],
        instruments: [],
        instrumentsNote: null,
        contentVersion: "2.0",
        rulesVersion: "2.0",
        panel: {
          ruleIds: ["R04"],
          trace: [],
          flags: [],
          pendingData: [],
          phraseIds: [],
          branchesOpened: ["I"],
          orientations: [],
          instruments: [],
          ai: [],
        },
      },
    };
    expect(withoutPanel(withResult).result?.panel).toBeNull();
    expect(withoutPanel(withResult).result?.texts).toEqual(withResult.result?.texts);
  });

  it("strips what the AI proposed from the panel but leaves the person their own confirmation screen", () => {
    const item = {
      id: "Q03",
      question: "¿Desde cuándo le ocurre?",
      answer: "6 meses",
      evidence: "Desde hace unos seis meses",
    };
    const confirming: FunnelState = {
      ...state(),
      step: {
        ...(state().step as NonNullable<FunnelState["step"]>),
        key: "Q01#confirmacion",
        questionId: "IA_CONFIRMAR",
        kind: "confirm_extraction",
        type: "confirm_extraction",
        text: "Por lo que nos ha contado, entendemos:",
        note: "¿Es correcto?",
        extraction: {
          source: "Q01",
          items: [
            {
              ...item,
              editable: true,
              type: "duration",
              options: [],
              fields: [],
              noneOption: false,
              unit: null,
              units: ["dias", "semanas", "meses", "años"],
            },
          ],
        },
        panel: {
          reason: "p. 14",
          source: "p. 14",
          branchesOpened: [],
          rulesFired: [],
          mainAction: null,
          phraseIds: [],
          instruments: [],
          ai: [
            {
              source: "Q01",
              status: "ok",
              model: "gpt-6-luna",
              promptVersion: "extraccion-v2.0-1",
              risk: { S1: "no", S4: "no", S2: "no" },
              discarded: 0,
              items: [{ ...item, decision: "pendiente", corrected: null }],
            },
          ],
        },
      },
    };
    const stripped = withoutPanel(confirming);
    expect(stripped.step?.panel).toBeNull();
    expect(stripped.step?.extraction).toEqual(confirming.step?.extraction);
  });

  it("renders the owner's finished interview as a PDF, from morpheo's result only", async () => {
    const finished: FunnelState = {
      ...state(),
      status: "finished",
      step: null,
      owned: true,
      result: {
        stoppedBy: null,
        alerts: [],
        mainAction: "TERAPIA",
        associatedActions: [],
        testToConsider: null,
        texts: [{ template: "T_INSOMNIO", text: "Nos ha contado que…" }],
        instruments: [],
        instrumentsNote: null,
        contentVersion: "2.0",
        rulesVersion: "2.0",
        panel: null,
      },
    };
    const morpheo = makeFakeIdentityClient((req) => {
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      return { status: 200, body: finished };
    });
    const identity = makeFakeIdentityClient(() => ({ status: 200, body: me([]) }));
    const report = makeFakeIdentityClient((req) => {
      expect(req.path).toBe("/internal/v1/reports/funnel/pdf");
      const body = JSON.parse(req.body ?? "{}");
      expect(body.texts).toEqual(finished.result?.texts);
      expect(body.sessionId).toBe("f-1");
      return {
        status: 200,
        body: {
          assessmentId: "f-1",
          templateVersion: "report_v2",
          definitionVersion: "2.0",
          contentVersion: "2.0",
          locale: "es",
          createdAt: "2026-10-19T10:00:00+00:00",
          pdfBase64: Buffer.from("%PDF-1.7").toString("base64"),
        },
      };
    });
    const service = new FunnelProxyService(
      morpheo.client,
      identity.client,
      resolver,
      report.client,
    );
    const pdf = await service.reportPdf(SESSION, "f-1", "es", "c1");
    expect(pdf.templateVersion).toBe("report_v2");
  });

  it("hands the one-page report to the report service when morpheo built one", async () => {
    const report = {
      status: "borrador" as const,
      layout: "standard" as const,
      headline: ["Le proponemos una terapia específica para el insomnio, llamada TCC-I."],
      secondary: [],
      summary: "se despierta varias veces por la noche.",
      steps: ["Diario 7-14 días y revisión propuesta a las 2-4 semanas."],
      help: { sentences: ["Si siente que el peligro es inmediato, llame al 112."], resources: [] },
      limits: ["No es un diagnóstico."],
      sources: [],
      professional: null,
    };
    const finished: FunnelState = {
      ...state(),
      status: "finished",
      step: null,
      owned: true,
      result: {
        stoppedBy: null,
        alerts: [],
        mainAction: "TERAPIA",
        associatedActions: [],
        testToConsider: null,
        texts: [{ template: "T_INSOMNIO", text: "Nos ha contado que…" }],
        instruments: [],
        instrumentsNote: null,
        contentVersion: "2.0",
        rulesVersion: "2.0",
        report,
        panel: null,
      },
    };
    const morpheo = makeFakeIdentityClient(() => ({ status: 200, body: finished }));
    const identity = makeFakeIdentityClient(() => ({ status: 200, body: me([]) }));
    const reportClient = makeFakeIdentityClient((req) => {
      expect(JSON.parse(req.body ?? "{}").report).toEqual(report);
      return {
        status: 200,
        body: {
          assessmentId: "f-1",
          templateVersion: "report_v3",
          definitionVersion: "2.0",
          contentVersion: "2.0",
          locale: "es",
          createdAt: "2026-10-19T10:00:00+00:00",
          pdfBase64: Buffer.from("%PDF-1.7").toString("base64"),
        },
      };
    });
    const service = new FunnelProxyService(
      morpheo.client,
      identity.client,
      resolver,
      reportClient.client,
    );
    const pdf = await service.reportPdf(SESSION, "f-1", "es", "c1");
    expect(pdf.templateVersion).toBe("report_v3");
    expect(withoutPanel(finished).result?.report).toEqual(report);
  });

  it("sends no report block when morpheo built none", async () => {
    const finished: FunnelState = {
      ...state(),
      status: "finished",
      step: null,
      owned: true,
      result: {
        stoppedBy: null,
        alerts: [],
        mainAction: "TERAPIA",
        associatedActions: [],
        testToConsider: null,
        texts: [{ template: "T_INSOMNIO", text: "Nos ha contado que…" }],
        instruments: [],
        instrumentsNote: null,
        contentVersion: "2.0",
        rulesVersion: "2.0",
        panel: null,
      },
    };
    const morpheo = makeFakeIdentityClient(() => ({ status: 200, body: finished }));
    const identity = makeFakeIdentityClient(() => ({ status: 200, body: me([]) }));
    const reportClient = makeFakeIdentityClient((req) => {
      expect(Object.keys(JSON.parse(req.body ?? "{}"))).not.toContain("report");
      return {
        status: 200,
        body: {
          assessmentId: "f-1",
          templateVersion: "report_v2",
          definitionVersion: "2.0",
          contentVersion: "2.0",
          locale: "es",
          createdAt: "2026-10-19T10:00:00+00:00",
          pdfBase64: Buffer.from("%PDF-1.7").toString("base64"),
        },
      };
    });
    const service = new FunnelProxyService(
      morpheo.client,
      identity.client,
      resolver,
      reportClient.client,
    );
    await service.reportPdf(SESSION, "f-1", "es", "c1");
  });

  it("gives no PDF for an interview that is not the person's own", async () => {
    const morpheo = makeFakeIdentityClient(() => ({ status: 200, body: state() }));
    const identity = makeFakeIdentityClient(() => ({ status: 200, body: me([]) }));
    const report = makeFakeIdentityClient(() => ({ status: 500 }));
    const service = new FunnelProxyService(
      morpheo.client,
      identity.client,
      resolver,
      report.client,
    );
    await expect(service.reportPdf(SESSION, "f-1", "es", "c1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(report.requests).toHaveLength(0);
  });
});
