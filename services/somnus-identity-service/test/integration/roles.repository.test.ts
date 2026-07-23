import { beforeEach, describe, expect, it } from "vitest";
import { RolesRepository } from "../../src/infrastructure/db/repositories/roles.repository.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

describe("RolesRepository", () => {
  const repo = new RolesRepository(getTestDb());

  beforeEach(async () => {
    await resetTables();
  });

  it("finds a role seeded by migration 0001_seed_platform_roles (build plan §11 catalog)", async () => {
    const found = await repo.findByKey("organization_admin");
    expect(found?.scope).toBe("organization");
    expect(found?.isInternal).toBe(false);
  });

  it("findManyByIds resolves several seeded roles at once", async () => {
    const admin = await repo.findByKey("organization_admin");
    const owner = await repo.findByKey("organization_owner");
    expect(admin).not.toBeNull();
    expect(owner).not.toBeNull();

    const found = await repo.findManyByIds([admin?.id ?? "", owner?.id ?? ""]);
    expect(found.map((r) => r.key).sort()).toEqual(["organization_admin", "organization_owner"]);
  });

  it("findManyByIds returns an empty array for an empty input without querying", async () => {
    expect(await repo.findManyByIds([])).toEqual([]);
  });

  it("seeds a permission and grants it to an existing seeded role", async () => {
    const role = await repo.findByKey("platform_admin");
    expect(role).not.toBeNull();
    const permissionId = await repo.seedPermission({
      key: "health_data:read",
      description: "Read health data",
    });

    await repo.grantPermission(role?.id ?? "", permissionId);

    expect(await repo.hasPermission(role?.id ?? "", permissionId)).toBe(true);
    const granted = await repo.listPermissionsForRole(role?.id ?? "");
    expect(granted.map((g) => g.permission.key)).toContain("health_data:read");
  });

  it("hasPermission is false for a role/permission pair that was never granted", async () => {
    const role = await repo.findByKey("support_agent");
    expect(role).not.toBeNull();
    const permissionId = await repo.seedPermission({
      key: "billing:read",
      description: "Read billing",
    });

    expect(await repo.hasPermission(role?.id ?? "", permissionId)).toBe(false);
  });
});
