import { Inject, Injectable } from "@nestjs/common";
import { type UserAssessmentsResponse, UserAssessmentsResponseSchema } from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { MORPHEO_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";

/** Carries the acting admin downstream, as the other admin proxies do. */
const ACTOR_ID_HEADER = "x-somnus-actor-id";

/**
 * The clinical half of break-glass (Addendum A §A2.3 / Checkpoint 15.5).
 *
 * A fourth sibling of the admin proxies, for the same reason the other three
 * exist: the target differs. Assessment results are morpheo's data and nobody
 * else's (§7), so this asks morpheo rather than reaching for a database.
 *
 * What it does NOT do is decide anything. Whether this admin may see this at all
 * is the capability guard's question, answered by identity; whether they gave a
 * usable justification is the DTO's; whether the access is recorded is the audit
 * interceptor's. This class only fetches, which is why it is this short.
 */
@Injectable()
export class AdminBreakGlassService {
  constructor(@Inject(MORPHEO_CLIENT) private readonly morpheo: CloudRunClient) {}

  async assessmentsFor(input: {
    subjectUserId: string;
    actorId: string;
    correlationId: string;
  }): Promise<UserAssessmentsResponse> {
    const response = await this.morpheo.post("/internal/v1/assessments/by-user", {
      correlationId: input.correlationId,
      headers: { [ACTOR_ID_HEADER]: input.actorId },
      body: { userId: input.subjectUserId },
    });

    const parsed = UserAssessmentsResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      // A shape morpheo did not promise is an INTERNAL error rather than
      // something the console renders. Showing an admin half-parsed clinical
      // content, under a justification they have already committed to, would be
      // worse than showing them an error.
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected morpheo response.", {
        correlationId: input.correlationId,
      });
    }
    return parsed.data;
  }
}
