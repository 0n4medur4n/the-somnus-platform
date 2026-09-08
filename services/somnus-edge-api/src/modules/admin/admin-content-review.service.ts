import { Inject, Injectable } from "@nestjs/common";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { ZodType } from "zod";
import { REPORT_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";

/** Carries the acting admin to the downstream service, as AdminProxyService does. */
const ACTOR_ID_HEADER = "x-somnus-actor-id";

/**
 * The admin console's half of the AI content review queue (Checkpoint 15.3).
 *
 * A sibling of `AdminProxyService` rather than a method on it, because the target
 * differs: verification cases and users live in identity, and the review queue
 * lives in `somnus_reporting`, which only the report service may touch (§7). Same
 * shape, same contract parsing, different client.
 *
 * edge-api still decides nothing. It names the `admin_content_review` capability
 * on the route, identity answers whether this actor holds it, and the decision
 * itself is recorded by the report service (§5.3).
 */
@Injectable()
export class AdminContentReviewService {
  constructor(@Inject(REPORT_CLIENT) private readonly report: CloudRunClient) {}

  async forward<T>(input: {
    method: "GET" | "POST";
    path: string;
    actorId: string;
    correlationId: string;
    schema: ZodType<T>;
    body?: unknown;
  }): Promise<T> {
    const headers = { [ACTOR_ID_HEADER]: input.actorId };
    const options = { correlationId: input.correlationId, headers };
    const response =
      input.method === "GET"
        ? await this.report.get(input.path, options)
        : await this.report.post(input.path, { ...options, body: input.body ?? {} });

    // A shape the report service did not promise is an INTERNAL error, never
    // something the console renders as fact -- and here "fact" would be clinical
    // prose awaiting a human decision, so the bar is the same as identity's.
    const parsed = input.schema.safeParse(response.body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected report-service response.", {
        correlationId: input.correlationId,
      });
    }
    return parsed.data;
  }
}
