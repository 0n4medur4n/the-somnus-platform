import { UUIDv7 } from "@somnus/api-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

describe("UsersRepository", () => {
  const repo = new UsersRepository(getTestDb());

  beforeEach(async () => {
    await resetTables();
  });

  it("creates a user and finds it by id and email", async () => {
    const id = await repo.create({ email: "ada@example.com" });
    const byId = await repo.findById(id);
    const byEmail = await repo.findByEmail("ada@example.com");

    expect(byId?.id).toBe(id);
    expect(byId?.locale).toBe("es");
    expect(byEmail?.id).toBe(id);
  });

  it("findById returns null for an unknown id", async () => {
    expect(await repo.findById(UUIDv7())).toBeNull();
  });

  it("links a Firebase identity and finds the user by provider id", async () => {
    const userId = await repo.create({ email: "grace@example.com" });
    await repo.linkIdentity({ userId, providerUserId: "firebase-uid-123" });

    const identity = await repo.findByProviderUserId("firebase-uid-123");
    expect(identity?.userId).toBe(userId);
  });
});
