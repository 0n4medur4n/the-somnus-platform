import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ADMIN_CAPABILITIES } from "@somnus/api-contracts";
import { describe, expect, it } from "vitest";

/**
 * The content review queue's routes are gated on the right capability
 * (Addendum A §A2.2 / Checkpoint 15.3).
 *
 * WHO holds `admin_content_review` is identity's decision and is tested
 * exhaustively there (`admin-capability-policy.test.ts` parametrizes over every
 * role key and asserts, among others, that `platform_admin` does NOT hold it).
 * What can only be tested here is the wiring: that these two routes ask for that
 * capability and no other, and that each emits an audit event.
 *
 * A route that shipped with the wrong capability would be gated -- just on the
 * wrong question -- and identity's matrix test would still be green. That is the
 * gap this closes.
 */

const CONTROLLER = fileURLToPath(
  new URL("../../src/modules/admin/admin-content-review.controller.ts", import.meta.url),
);
const source = readFileSync(CONTROLLER, "utf8");

/** Every `@AdminRoute({...})` block in the controller, with its route path. */
function routes(): { path: string; meta: string }[] {
  const found: { path: string; meta: string }[] = [];
  const pattern = /@(?:Get|Post|Patch)\("([^"]+)"\)([\s\S]*?)@AdminRoute\(\{([\s\S]*?)\}\)/g;
  for (const match of source.matchAll(pattern)) {
    found.push({ path: match[1] ?? "", meta: match[3] ?? "" });
  }
  return found;
}

const declared = routes();

describe("the queue's route table", () => {
  it("has both routes the checkpoint requires, and only those", () => {
    expect(declared.map((route) => route.path).sort()).toEqual([
      "content-review/items",
      "content-review/items/:itemId/decision",
    ]);
  });

  it.each(declared.map((route) => route.path))("%s asks for admin_content_review", (path) => {
    const route = declared.find((candidate) => candidate.path === path);

    expect(route?.meta).toContain('capability: "admin_content_review"');
  });

  it.each(declared.map((route) => route.path))("%s asks for no other capability", (path) => {
    const route = declared.find((candidate) => candidate.path === path);
    const others = ADMIN_CAPABILITIES.filter(
      (capability) => capability !== "admin_content_review",
    ).filter((capability) => route?.meta.includes(`"${capability}"`));

    expect(others).toEqual([]);
  });

  it.each(declared.map((route) => route.path))("%s emits an audit event", (path) => {
    // Reads included: who looked at a queue of unreleased AI-written clinical
    // prose is exactly what an audit of an internal console must answer.
    const route = declared.find((candidate) => candidate.path === path);

    expect(route?.meta).toMatch(/eventType: "admin\.content_review[a-z_]*\.[a-z_]+\.v\d+"/);
    expect(route?.meta).toContain('entity: "content_review_item"');
  });
});

describe("the controller cannot be reached unguarded", () => {
  it("declares the session guard and the capability guard together", () => {
    expect(source).toMatch(/@UseGuards\([^)]*SessionGuard[^)]*AdminCapabilityGuard[^)]*\)/);
  });

  it("declares the audit interceptor", () => {
    expect(source).toMatch(/@UseInterceptors\([^)]*AdminAuditInterceptor[^)]*\)/);
  });
});

describe("the reviewer's identity comes from the session, never the client", () => {
  it("overwrites any reviewerId the console might send", () => {
    // A console that could name its own reviewer would make the audit trail
    // worthless: the decision would record whoever the caller claimed to be.
    // The spread order is what enforces it, so the order is what is asserted.
    expect(source).toMatch(/body: \{ \.\.\.body, reviewerId: actorId \}/);
  });

  it("takes the actor from the session record", () => {
    expect(source).toMatch(/return session\?\.somnusUserId \?\? ""/);
  });
});
