import { Inject, Injectable } from "@nestjs/common";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { ZodType } from "zod";
import { MORPHEO_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";

/** Carries the acting admin downstream, as the other admin proxies do. */
const ACTOR_ID_HEADER = "x-somnus-actor-id";

/**
 * The console's half of Morpheo's case records (ADR 0024).
 *
 * A sibling of `AdminBreakGlassService`, for the same reason: the cases are
 * morpheo's data and nobody else's (§7), so this asks morpheo rather than
 * reaching for a database. It decides nothing -- the capability guard, the DTO
 * and the audit interceptor do -- and morpheo records each case opening itself,
 * under the actor sent here, before it answers.
 */
@Injectable()
export class AdminMorpheoCasesService {
  constructor(@Inject(MORPHEO_CLIENT) private readonly morpheo: CloudRunClient) {}

  async forward<T>(input: {
    path: string;
    actorId: string;
    correlationId: string;
    schema: ZodType<T>;
    body: unknown;
  }): Promise<T> {
    const response = await this.morpheo.post(input.path, {
      correlationId: input.correlationId,
      headers: { [ACTOR_ID_HEADER]: input.actorId },
      body: input.body,
    });

    // A shape morpheo did not promise is an INTERNAL error rather than
    // something the console renders: a case shown half-parsed is worse, in an
    // audit, than no case shown.
    const parsed = input.schema.safeParse(response.body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected morpheo response.", {
        correlationId: input.correlationId,
      });
    }
    return parsed.data;
  }
}
