import { Inject, Injectable } from "@nestjs/common";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { ZodType } from "zod";
import { WORKER_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";

/** Carries the acting admin downstream, as the other admin proxies do. */
const ACTOR_ID_HEADER = "x-somnus-actor-id";

/**
 * The console's half of the statistics dashboards and audit viewer
 * (Checkpoint 15.4).
 *
 * A third sibling of `AdminProxyService`, and for the same reason the content
 * review one exists: the target differs. Users and verification live in identity,
 * the AI review queue in `somnus_reporting`, and the audit store in the worker's
 * isolated Audit module (§5.7 / ADR 0010). Same shape, same contract parsing,
 * different client -- and no second connection to a database this service does
 * not own.
 */
@Injectable()
export class AdminInsightsService {
  constructor(@Inject(WORKER_CLIENT) private readonly worker: CloudRunClient) {}

  async forward<T>(input: {
    path: string;
    actorId: string;
    correlationId: string;
    schema: ZodType<T>;
    body?: unknown;
  }): Promise<T> {
    const response = await this.worker.post(input.path, {
      correlationId: input.correlationId,
      headers: { [ACTOR_ID_HEADER]: input.actorId },
      body: input.body ?? {},
    });

    // A shape the worker did not promise is an INTERNAL error, never something
    // the console renders as fact. For a dashboard that matters twice over: a
    // number nobody validated is worse than no number.
    const parsed = input.schema.safeParse(response.body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected worker response.", {
        correlationId: input.correlationId,
      });
    }
    return parsed.data;
  }
}
