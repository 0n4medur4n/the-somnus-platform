import type { CloudRunClient } from "@somnus/cloud-run-client";
import { SomnusError } from "@somnus/errors";
import { describe, expect, it, vi } from "vitest";
import { AdminDriveTranslateService } from "../../src/modules/admin/admin-drive-translate.service.js";

/**
 * Translating what is read aloud (owner decision 2026-11-03): like
 * proofreading, the edge waits for the model once and passes on only an
 * answer with one translation per passage sent.
 */
describe("AdminDriveTranslateService", () => {
  const client = (body: unknown) => {
    const post = vi.fn().mockResolvedValue({ status: 200, headers: {}, body });
    return { post, report: { post } as unknown as CloudRunClient };
  };

  it("waits long enough for the model, once, and passes the acting admin", async () => {
    const { post, report } = client({ passages: ["Hola.", "Adiós."] });
    const body = { passages: ["Hello.", "Goodbye."], lang: "es" };
    const result = await new AdminDriveTranslateService(report).translate({
      body,
      actorId: "018f0000-0000-7000-8000-0000000000aa",
      correlationId: "c1",
    });
    expect(result).toEqual({ passages: ["Hola.", "Adiós."] });
    expect(post).toHaveBeenCalledWith("/internal/v1/drive/translate", {
      correlationId: "c1",
      headers: { "x-somnus-actor-id": "018f0000-0000-7000-8000-0000000000aa" },
      body,
      timeoutMs: 50_000,
      skipRetry: true,
    });
  });

  it("refuses an answer the contract does not allow, or with a passage missing", async () => {
    for (const answer of [{ passages: [1] }, { passages: ["Hola."] }]) {
      const { report } = client(answer);
      await expect(
        new AdminDriveTranslateService(report).translate({
          body: { passages: ["Hello.", "Goodbye."] },
          actorId: "a",
          correlationId: "c2",
        }),
      ).rejects.toBeInstanceOf(SomnusError);
    }
  });
});
