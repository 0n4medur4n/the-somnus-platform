import { Inject, Injectable } from "@nestjs/common";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { ZodType } from "zod";
import { REPORT_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";

/** Carries the acting admin downstream, as the other admin proxies do. */
const ACTOR_ID_HEADER = "x-somnus-actor-id";

/**
 * The console's half of reference-corpus management (Addendum B §B3 / 16.3).
 *
 * A fifth sibling of the admin proxies, for the reason the others exist: the
 * target differs. The corpus lives in `somnus_content`, owned by the report
 * service's isolated corpus module (ADR 0010), so this forwards there rather
 * than reaching for a database of its own (§7).
 *
 * It decides nothing, and in particular it does not decide anything about the
 * corpus. Whether this admin may manage the corpus at all is the capability
 * guard's question, answered by identity (§5.3); whether a document's rights
 * permit publishing is §B4's gate, which lives in the report service and is
 * called by the publish transition itself. There is deliberately no check here
 * that could agree with that gate today and drift from it later.
 */
@Injectable()
export class AdminCorpusService {
  constructor(@Inject(REPORT_CLIENT) private readonly report: CloudRunClient) {}

  async forward<T>(input: {
    method: "GET" | "POST";
    path: string;
    actorId: string;
    correlationId: string;
    schema: ZodType<T>;
    body?: unknown;
    /** Longer for the routes that read a file or fetch a page. */
    timeoutMs?: number;
  }): Promise<T> {
    const options = {
      correlationId: input.correlationId,
      headers: { [ACTOR_ID_HEADER]: input.actorId },
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    };
    let response: Awaited<ReturnType<CloudRunClient["get"]>>;
    try {
      response =
        input.method === "GET"
          ? await this.report.get(input.path, options)
          : await this.report.post(input.path, { ...options, body: input.body ?? {} });
    } catch (error) {
      // The report service refuses a file or a page it cannot use (unreadable,
      // scanned, protected, too large, not public) with a 4xx the shared client
      // would otherwise surface as a 500. It is the admin's input that was
      // refused, so it is a validation failure -- and never a 5xx alert.
      const upstream = error instanceof SomnusError ? error.details["upstreamStatus"] : undefined;
      if (upstream === 400 || upstream === 413 || upstream === 422) {
        throw new SomnusError(ErrorCode.VALIDATION_FAILED, "The corpus refused this input.", {
          correlationId: input.correlationId,
          details: { reason: "CORPUS_INPUT_REFUSED", upstreamStatus: upstream },
        });
      }
      throw error;
    }

    // A shape the report service did not promise is an INTERNAL error, never
    // something the console renders as the state of the corpus -- an admin who
    // believes a document is published when it is not would retire the wrong
    // thing.
    const parsed = input.schema.safeParse(response.body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected report-service response.", {
        correlationId: input.correlationId,
      });
    }
    return parsed.data;
  }
}
