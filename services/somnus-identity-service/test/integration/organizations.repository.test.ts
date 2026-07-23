import { UUIDv7 } from "@somnus/api-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { OrganizationsRepository } from "../../src/infrastructure/db/repositories/organizations.repository.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

describe("OrganizationsRepository", () => {
  const repo = new OrganizationsRepository(getTestDb());

  beforeEach(async () => {
    await resetTables();
  });

  it("creates an organization and finds it by id", async () => {
    const id = await repo.create({ name: "Acme Health" });
    const found = await repo.findById(id);
    expect(found?.name).toBe("Acme Health");
    expect(found?.status).toBe("active");
  });

  it("findById returns null for an unknown organization", async () => {
    expect(await repo.findById(UUIDv7())).toBeNull();
  });

  it("adds locations scoped to the organization and lists only that organization's locations", async () => {
    const orgA = await repo.create({ name: "Org A" });
    const orgB = await repo.create({ name: "Org B" });
    await repo.addLocation({ organizationId: orgA, name: "Madrid HQ" });
    await repo.addLocation({ organizationId: orgB, name: "Lisbon HQ" });

    const locationsA = await repo.listLocations({ organizationId: orgA });
    expect(locationsA).toHaveLength(1);
    expect(locationsA[0]?.name).toBe("Madrid HQ");
  });
});
