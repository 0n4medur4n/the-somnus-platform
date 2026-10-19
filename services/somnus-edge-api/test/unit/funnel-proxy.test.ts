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
      panel: {
        reason: null,
        source: "AGE",
        branchesOpened: [],
        rulesFired: [],
        mainAction: null,
        phraseIds: [],
        instruments: [],
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
    service: new FunnelProxyService(morpheo.client, identity.client, actorResolver),
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
    const service = new FunnelProxyService(morpheo.client, identity.client, resolver);
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
        },
      },
    };
    expect(withoutPanel(withResult).result?.panel).toBeNull();
    expect(withoutPanel(withResult).result?.texts).toEqual(withResult.result?.texts);
  });
});
