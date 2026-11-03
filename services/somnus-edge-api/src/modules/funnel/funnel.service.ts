import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type FunnelAnswerRequest,
  type FunnelConfigResponse,
  FunnelConfigResponseSchema,
  type FunnelCreateRequest,
  type FunnelDictationRequest,
  type FunnelDictationSession,
  FunnelDictationSessionSchema,
  type FunnelOwnSessions,
  FunnelOwnSessionsSchema,
  type FunnelRewindRequest,
  type FunnelState,
  FunnelStateSchema,
  MeResponseSchema,
  makeEvent,
  type ReportPdf,
  ReportPdfSchema,
  type SupportedLocale,
} from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { ZodType } from "zod";
import { correlationOf, requireSession } from "../../common/composition.util.js";
import {
  EDGE_EVENT_PUBLISHER,
  type EventPublisher,
} from "../../infrastructure/events/event-publisher.js";
import { ACTOR_ID_HEADER } from "../../infrastructure/internal-clients/headers.js";
import {
  IDENTITY_CLIENT,
  MORPHEO_CLIENT,
  REPORT_CLIENT,
  WORKER_CLIENT,
} from "../../infrastructure/internal-clients/internal-clients.module.js";
import { ActorResolver } from "../sessions/actor-resolver.service.js";
import type { SessionRecord } from "../sessions/session.service.js";

const FUNNEL = "/internal/v1/funnel";
/**
 * An answer to a free-text question waits for morpheo's AI step (v0.2 p. 14),
 * which gives up on the model after AI_TIMEOUT_SECONDS (12 s by default) and
 * goes on without it. The edge waits longer than that, plus a cold start.
 */
const FUNNEL_ANSWER_TIMEOUT_MS = 25_000;
/**
 * The PDF waits for the report service, which may cold-start, search the library
 * for the professional's excerpts (about 12 s the first time on an instance, with
 * its own 20 s ceiling) and lay the pages out. The default 5 s was far too short
 * (seen on an iPhone, 2026-10-27). Never re-sent: a retry would pay it twice.
 */
const FUNNEL_PDF_TIMEOUT_MS = 45_000;

/**
 * Proxies the v2 interview (the embudo v0.2) to morpheo. The edge never runs
 * the engine and never decides a step: it forwards the answer to the step
 * morpheo served and returns morpheo's state. Two things are the edge's own:
 *
 * - who is asking: a signed-in person's id goes to morpheo as the actor
 *   header (their interview is theirs from the start); the browser never
 *   names anyone;
 * - the team panel: kept only when the app asks for it and the person has an
 *   internal role (identity decides); stripped for everyone else.
 */
@Injectable()
export class FunnelProxyService {
  private readonly logger = new Logger(FunnelProxyService.name);

  constructor(
    @Inject(MORPHEO_CLIENT) private readonly morpheo: CloudRunClient,
    @Inject(IDENTITY_CLIENT) private readonly identity: CloudRunClient,
    private readonly actorResolver: ActorResolver,
    @Inject(REPORT_CLIENT) private readonly report: CloudRunClient,
    @Inject(WORKER_CLIENT) private readonly worker: CloudRunClient,
    @Inject(EDGE_EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async config(rawCorrelationId?: string): Promise<FunnelConfigResponse> {
    const correlationId = correlationOf(rawCorrelationId);
    const response = await this.morpheo.get(`${FUNNEL}/config`, { correlationId });
    return this.parse(FunnelConfigResponseSchema, response.body, correlationId);
  }

  create(
    session: SessionRecord | undefined,
    body: FunnelCreateRequest,
    panel: boolean,
    rawCorrelationId?: string,
  ): Promise<FunnelState> {
    return this.forward("POST", `${FUNNEL}/sessions`, session, panel, rawCorrelationId, body);
  }

  /** The signed-in person's own finished interviews, newest first (their list). */
  async listOwn(
    session: SessionRecord | undefined,
    rawCorrelationId?: string,
  ): Promise<FunnelOwnSessions> {
    const correlationId = correlationOf(rawCorrelationId);
    const actorId = await this.actorResolver.resolve(
      requireSession(session, correlationId),
      correlationId,
    );
    const response = await this.morpheo.get(`${FUNNEL}/sessions`, {
      correlationId,
      headers: { [ACTOR_ID_HEADER]: actorId },
    });
    return this.parse(FunnelOwnSessionsSchema, response.body, correlationId);
  }

  get(
    session: SessionRecord | undefined,
    sessionId: string,
    panel: boolean,
    rawCorrelationId?: string,
  ): Promise<FunnelState> {
    return this.forward("GET", this.path(sessionId), session, panel, rawCorrelationId);
  }

  answer(
    session: SessionRecord | undefined,
    sessionId: string,
    body: FunnelAnswerRequest,
    panel: boolean,
    rawCorrelationId?: string,
  ): Promise<FunnelState> {
    const path = `${this.path(sessionId)}/answers`;
    return this.forward("POST", path, session, panel, rawCorrelationId, body, {
      timeoutMs: FUNNEL_ANSWER_TIMEOUT_MS,
    });
  }

  back(
    session: SessionRecord | undefined,
    sessionId: string,
    panel: boolean,
    rawCorrelationId?: string,
  ): Promise<FunnelState> {
    return this.forward("POST", `${this.path(sessionId)}/back`, session, panel, rawCorrelationId);
  }

  /**
   * A pass so the browser can dictate the free-text step it is on (ADR 0026).
   * The interview must be open on a free-text step — the same check as showing
   * the box — before any token is minted. The audio goes from the browser to
   * AssemblyAI; nothing here is logged, and the audit event records only that
   * a pass was issued and in which language.
   */
  async dictation(
    session: SessionRecord | undefined,
    sessionId: string,
    body: FunnelDictationRequest,
    rawCorrelationId?: string,
  ): Promise<FunnelDictationSession> {
    const correlationId = correlationOf(rawCorrelationId);
    const state = await this.get(session, sessionId, false, correlationId);
    const type = state.status === "open" ? state.step?.type : undefined;
    if (type !== "free_text" && type !== "yes_no_note") {
      throw new SomnusError(
        ErrorCode.VALIDATION_FAILED,
        "Dictation is only for an open free-text step.",
        { correlationId },
      );
    }
    const response = await this.worker.post("/internal/v1/drive/speech/interview-dictation", {
      correlationId,
      body,
      skipRetry: true,
    });
    const parsed = FunnelDictationSessionSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected worker response.", { correlationId });
    }
    const actorId = await this.actorOf(session, correlationId);
    try {
      await this.events.publish(
        makeEvent({
          eventType: "morpheo.dictation.started.v1",
          producer: "somnus-edge-api",
          correlationId,
          ...(actorId ? { actor: { type: "user", id: actorId } } : {}),
          subject: { type: "funnel_session", id: sessionId },
          data: { lang: body.lang },
        }),
      );
    } catch {
      // The pass is already minted. Auditing must not hide it from the person.
    }
    return parsed.data;
  }

  rewind(
    session: SessionRecord | undefined,
    sessionId: string,
    body: FunnelRewindRequest,
    panel: boolean,
    rawCorrelationId?: string,
  ): Promise<FunnelState> {
    const path = `${this.path(sessionId)}/rewind`;
    return this.forward("POST", path, session, panel, rawCorrelationId, body);
  }

  /**
   * The person's own v2 report as a PDF: their finished interview's final text,
   * laid out by the report service. Signed-in owners only; anything else reads
   * as not found. Deterministic -- no model is involved.
   */
  async reportPdf(
    session: SessionRecord | undefined,
    sessionId: string,
    locale: SupportedLocale,
    rawCorrelationId?: string,
  ): Promise<ReportPdf> {
    const correlationId = correlationOf(rawCorrelationId);
    const actorId = await this.actorResolver.resolve(
      requireSession(session, correlationId),
      correlationId,
    );
    const response = await this.morpheo.get(this.path(sessionId), {
      correlationId,
      headers: { [ACTOR_ID_HEADER]: actorId },
    });
    const state = this.parse(FunnelStateSchema, response.body, correlationId);
    if (!state.owned || !state.result || state.result.texts.length === 0) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "No finished interview of yours.", {
        correlationId,
      });
    }
    const rendered = await this.report.post("/internal/v1/reports/funnel/pdf", {
      correlationId,
      timeoutMs: FUNNEL_PDF_TIMEOUT_MS,
      skipRetry: true,
      body: {
        sessionId,
        locale,
        completedAt: new Date().toISOString(),
        contentVersion: state.result.contentVersion,
        rulesVersion: state.result.rulesVersion,
        texts: state.result.texts,
        instruments: state.result.instruments,
        instrumentsNote: state.result.instrumentsNote,
        // The one-page report, when morpheo built one (REPORT_V3_ENABLED).
        ...(state.result.report ? { report: state.result.report } : {}),
        // The case number (ADR 0024), for the footer, when morpheo sent one.
        ...(state.caseCode ? { caseCode: state.caseCode } : {}),
      },
    });
    return this.parse(ReportPdfSchema, rendered.body, correlationId);
  }

  private path(sessionId: string): string {
    return `${FUNNEL}/sessions/${encodeURIComponent(sessionId)}`;
  }

  private async forward(
    method: "GET" | "POST",
    path: string,
    session: SessionRecord | undefined,
    panel: boolean,
    rawCorrelationId: string | undefined,
    body?: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<FunnelState> {
    const correlationId = correlationOf(rawCorrelationId);
    const actorId = await this.actorOf(session, correlationId);
    const headers: Record<string, string> = actorId ? { [ACTOR_ID_HEADER]: actorId } : {};
    const response =
      method === "GET"
        ? await this.morpheo.get(path, { correlationId, headers })
        : // Never re-sent: an answer that timed out may already be stored, and a
          // second copy is refused as "not the current step" (seen in the
          // 200-case live test, 2026-10-20). The person retries, not the edge.
          await this.morpheo.post(path, {
            correlationId,
            headers,
            body,
            skipRetry: true,
            ...options,
          });
    const state = this.parse(FunnelStateSchema, response.body, correlationId);
    const staff = panel && actorId !== undefined && (await this.isStaff(actorId, correlationId));
    return staff ? state : withoutPanel(state);
  }

  /** The signed-in person's id; anyone else (or a half-registered account) is anonymous. */
  private async actorOf(
    session: SessionRecord | undefined,
    correlationId: string,
  ): Promise<string | undefined> {
    if (!session) return undefined;
    try {
      return await this.actorResolver.resolve(session, correlationId);
    } catch {
      this.logger.warn({ correlationId, message: "funnel: session without a Somnus user" });
      return undefined;
    }
  }

  /** Identity owns roles (§5.3): the panel is for platform staff only. */
  private async isStaff(actorId: string, correlationId: string): Promise<boolean> {
    try {
      const response = await this.identity.get("/v1/me", {
        correlationId,
        headers: { [ACTOR_ID_HEADER]: actorId },
      });
      const me = MeResponseSchema.safeParse(response.body);
      return me.success && me.data.account.internalRoles.length > 0;
    } catch {
      return false;
    }
  }

  private parse<T>(schema: ZodType<T>, body: unknown, correlationId: string): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected morpheo response.", { correlationId });
    }
    return parsed.data;
  }
}

/** The state as anyone without an internal role receives it. */
export function withoutPanel(state: FunnelState): FunnelState {
  return {
    ...state,
    step: state.step ? { ...state.step, panel: null } : null,
    result: state.result ? { ...state.result, panel: null } : null,
  };
}
