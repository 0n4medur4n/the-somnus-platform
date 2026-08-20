import { describe, expect, it } from "vitest";
import { NotificationTaskSchema } from "./task.js";

const valid = {
  idempotencyKey: "invite:org-1:user-2",
  type: "invitation" as const,
  to: "person@example.com",
  locale: "es" as const,
  link: "https://app.somnus.example/invitations/accept?token=abc",
  params: { organizationName: "Acme", inviterName: "Ada" },
};

describe("NotificationTaskSchema", () => {
  it("accepts a well-formed task and defaults params to {}", () => {
    const parsed = NotificationTaskSchema.parse({ ...valid, params: undefined });
    expect(parsed.params).toEqual({});
    expect(parsed.type).toBe("invitation");
  });

  it("rejects a missing idempotency key, a bad email, and a non-url link", () => {
    expect(NotificationTaskSchema.safeParse({ ...valid, idempotencyKey: "" }).success).toBe(false);
    expect(NotificationTaskSchema.safeParse({ ...valid, to: "not-an-email" }).success).toBe(false);
    expect(NotificationTaskSchema.safeParse({ ...valid, link: "not-a-url" }).success).toBe(false);
  });

  it("rejects unknown fields — no smuggling health data into the task (strict)", () => {
    const withExtra = { ...valid, healthLevel: "L0" };
    expect(NotificationTaskSchema.safeParse(withExtra).success).toBe(false);
  });

  it("only allows the two notification types", () => {
    expect(NotificationTaskSchema.safeParse({ ...valid, type: "report_ready" }).success).toBe(true);
    expect(NotificationTaskSchema.safeParse({ ...valid, type: "password_reset" }).success).toBe(
      false,
    );
  });
});
