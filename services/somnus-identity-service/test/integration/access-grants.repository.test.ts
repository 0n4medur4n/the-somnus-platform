import { beforeEach, describe, expect, it } from "vitest";
import { AccessGrantsRepository } from "../../src/infrastructure/db/repositories/access-grants.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

describe("AccessGrantsRepository", () => {
  const db = getTestDb();
  const users = new UsersRepository(db);
  const repo = new AccessGrantsRepository(db);

  beforeEach(async () => {
    await resetTables();
  });

  it("grants access and finds it scoped to the subject (build plan §11)", async () => {
    const subject = await users.create({ email: "patient@example.com" });
    const professional = await users.create({ email: "doctor@example.com" });
    const granter = await users.create({ email: "admin@example.com" });

    await repo.create({
      userId: subject,
      professionalUserId: professional,
      grantedBy: granter,
      scope: "clinical_data:read",
    });

    const active = await repo.listActiveForSubject({ userId: subject });
    expect(active).toHaveLength(1);

    const grant = await repo.findActiveGrant({ userId: subject, professionalUserId: professional });
    expect(grant?.scope).toBe("clinical_data:read");
  });

  it("no grant is visible under a different subject's scope", async () => {
    const subjectA = await users.create({ email: "patientA@example.com" });
    const subjectB = await users.create({ email: "patientB@example.com" });
    const professional = await users.create({ email: "doctor2@example.com" });
    const granter = await users.create({ email: "admin2@example.com" });
    await repo.create({
      userId: subjectA,
      professionalUserId: professional,
      grantedBy: granter,
      scope: "clinical_data:read",
    });

    expect(await repo.listActiveForSubject({ userId: subjectB })).toHaveLength(0);
    expect(
      await repo.findActiveGrant({ userId: subjectB, professionalUserId: professional }),
    ).toBeNull();
  });

  it("revoke removes the grant from the active list (build plan §11: revoked grants deny access)", async () => {
    const subject = await users.create({ email: "patient3@example.com" });
    const professional = await users.create({ email: "doctor3@example.com" });
    const granter = await users.create({ email: "admin3@example.com" });
    const grantId = await repo.create({
      userId: subject,
      professionalUserId: professional,
      grantedBy: granter,
      scope: "clinical_data:read",
    });

    await repo.revoke({ userId: subject, grantId });

    expect(await repo.listActiveForSubject({ userId: subject })).toHaveLength(0);
    expect(
      await repo.findActiveGrant({ userId: subject, professionalUserId: professional }),
    ).toBeNull();
  });
});
