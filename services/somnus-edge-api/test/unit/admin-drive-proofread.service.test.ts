import type { CloudRunClient } from "@somnus/cloud-run-client";
import { SomnusError } from "@somnus/errors";
import { describe, expect, it, vi } from "vitest";
import { AdminDriveProofreadService } from "../../src/modules/admin/admin-drive-proofread.service.js";

/**
 * Proofreading (owner decision 2026-11-02): the model takes seconds, more when
 * the report service starts cold, so the edge waits for it and never asks
 * twice. A first version used the default timeout and retry: the console got a
 * 502 while the report service was still answering.
 */
describe("AdminDriveProofreadService", () => {
  const client = (body: unknown) => {
    const post = vi.fn().mockResolvedValue({ status: 200, headers: {}, body });
    return { post, report: { post } as unknown as CloudRunClient };
  };

  it("waits long enough for the model, once, and passes the acting admin", async () => {
    const { post, report } = client({ suggestions: [] });
    const result = await new AdminDriveProofreadService(report).proofread({
      body: { text: "Hola", lang: "es" },
      actorId: "018f0000-0000-7000-8000-0000000000aa",
      correlationId: "c1",
    });
    expect(result).toEqual({ suggestions: [] });
    expect(post).toHaveBeenCalledWith("/internal/v1/drive/proofread", {
      correlationId: "c1",
      headers: { "x-somnus-actor-id": "018f0000-0000-7000-8000-0000000000aa" },
      body: { text: "Hola", lang: "es" },
      timeoutMs: 50_000,
      skipRetry: true,
    });
  });

  it("refuses an answer the contract does not allow", async () => {
    const { report } = client({ suggestions: [{ start: 0 }] });
    await expect(
      new AdminDriveProofreadService(report).proofread({
        body: {},
        actorId: "a",
        correlationId: "c2",
      }),
    ).rejects.toBeInstanceOf(SomnusError);
  });
});
