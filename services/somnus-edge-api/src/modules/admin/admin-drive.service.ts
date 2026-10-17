import { Inject, Injectable } from "@nestjs/common";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { ZodType } from "zod";
import { WORKER_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";

/** Carries the acting admin downstream, as the other admin proxies do. */
const ACTOR_ID_HEADER = "x-somnus-actor-id";
/** The session's own email, sent only where a Drive identity is created or reset. */
const ACTOR_EMAIL_HEADER = "x-somnus-actor-email";

/**
 * The console's half of the staff Drive (owner decision 2026-10-17, ADR 0019).
 *
 * The Drive lives in the worker's isolated Drive module (`somnus_drive`), so
 * this forwards there, as the insights proxy does for the audit store (§7).
 * It decides nothing: whether the session may use the Drive at all is the
 * capability guard's question (identity), and which folder a person may touch
 * is the Drive module's. Everything it carries is ciphertext or a public key.
 */
@Injectable()
export class AdminDriveService {
  constructor(@Inject(WORKER_CLIENT) private readonly worker: CloudRunClient) {}

  async forward<T>(input: {
    method: "GET" | "POST" | "PUT";
    path: string;
    actorId: string;
    actorEmail?: string;
    correlationId: string;
    schema?: ZodType<T>;
    body?: unknown;
  }): Promise<T> {
    const headers: Record<string, string> = { [ACTOR_ID_HEADER]: input.actorId };
    if (input.actorEmail !== undefined) headers[ACTOR_EMAIL_HEADER] = input.actorEmail;
    const options = { correlationId: input.correlationId, headers };

    const response =
      input.method === "GET"
        ? await this.worker.get(input.path, options)
        : input.method === "PUT"
          ? await this.worker.put(input.path, { ...options, body: input.body ?? {} })
          : await this.worker.post(input.path, { ...options, body: input.body ?? {} });

    if (!input.schema) return undefined as T;
    // A shape the worker did not promise is an INTERNAL error. For the Drive
    // that matters more than anywhere: the console decrypts what it is given,
    // and should never be handed something nobody validated.
    const parsed = input.schema.safeParse(response.body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected worker response.", {
        correlationId: input.correlationId,
      });
    }
    return parsed.data;
  }
}
