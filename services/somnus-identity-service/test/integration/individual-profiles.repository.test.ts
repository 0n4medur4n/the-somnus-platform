import { beforeEach, describe, expect, it } from "vitest";
import { IndividualProfilesRepository } from "../../src/infrastructure/db/repositories/individual-profiles.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

describe("IndividualProfilesRepository", () => {
  const db = getTestDb();
  const users = new UsersRepository(db);
  const repo = new IndividualProfilesRepository(db);

  beforeEach(async () => {
    await resetTables();
  });

  it("creates a profile and finds it by user scope", async () => {
    const userId = await users.create({ email: "user1@example.com" });
    await repo.create({ userId, firstName: "Ada", lastName: "Lovelace" });

    const found = await repo.findByUser({ userId });
    expect(found?.firstName).toBe("Ada");
  });

  it("scoping is real: a different user's scope finds nothing", async () => {
    const userA = await users.create({ email: "a@example.com" });
    const userB = await users.create({ email: "b@example.com" });
    await repo.create({ userId: userA, firstName: "A", lastName: "One" });

    expect(await repo.findByUser({ userId: userB })).toBeNull();
    expect(await repo.findByUser({ userId: userA })).not.toBeNull();
  });

  it("patch updates only the scoped user's profile", async () => {
    const userId = await users.create({ email: "patch@example.com" });
    await repo.create({ userId, firstName: "Old", lastName: "Name" });

    await repo.patch({ userId }, { firstName: "New" });

    const found = await repo.findByUser({ userId });
    expect(found?.firstName).toBe("New");
  });
});
