import { beforeEach, describe, expect, it } from "vitest";
import { ProfessionalProfilesRepository } from "../../src/infrastructure/db/repositories/professional-profiles.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

describe("ProfessionalProfilesRepository", () => {
  const db = getTestDb();
  const users = new UsersRepository(db);
  const repo = new ProfessionalProfilesRepository(db);

  beforeEach(async () => {
    await resetTables();
  });

  it("creates a professional profile, finds it by user scope, and defaults to pending verification", async () => {
    const userId = await users.create({ email: "dr@example.com" });
    await repo.create({ userId, specialty: "psychologist", licenseNumber: "LIC-1" });

    const found = await repo.findByUser({ userId });
    expect(found?.specialty).toBe("psychologist");
    expect(found?.verificationStatus).toBe("pending");
  });

  it("adds and lists credentials for a profile", async () => {
    const userId = await users.create({ email: "dr2@example.com" });
    const profileId = await repo.create({ userId, specialty: "nurse", licenseNumber: "LIC-2" });
    await repo.addCredential({
      professionalProfileId: profileId,
      credentialType: "RN License",
      issuer: "Board",
    });

    const credentials = await repo.listCredentials(profileId);
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.credentialType).toBe("RN License");
  });

  it("opens and lists verification cases for a profile", async () => {
    const userId = await users.create({ email: "dr3@example.com" });
    const profileId = await repo.create({ userId, specialty: "therapist", licenseNumber: "LIC-3" });
    await repo.openVerificationCase(profileId);

    const cases = await repo.listVerificationCases(profileId);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.status).toBe("pending");
  });
});
