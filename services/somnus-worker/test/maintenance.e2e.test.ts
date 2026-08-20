import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { MaintenanceDeleteResult } from "@somnus/api-contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { MORPHEO_MAINTENANCE_CLIENT } from "../src/modules/maintenance/maintenance.module.js";
import type { MorpheoMaintenanceClient } from "../src/modules/maintenance/morpheo-maintenance.client.js";

class FakeClient implements MorpheoMaintenanceClient {
  async deleteUnclaimedAssessments(_before: string): Promise<MaintenanceDeleteResult> {
    return { deleted: 5 };
  }
  async deleteExpiredClaimTokens(_before: string): Promise<MaintenanceDeleteResult> {
    return { deleted: 3 };
  }
}

describe("maintenance jobs (e2e)", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MORPHEO_MAINTENANCE_CLIENT)
      .useValue(new FakeClient())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("runs the unclaimed-assessment cleanup and returns the deleted count", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/jobs/cleanup-unclaimed-assessments",
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ deleted: 5 });
  });

  it("runs the claim-token cleanup", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/jobs/cleanup-claim-tokens",
    });
    expect(response.json()).toEqual({ deleted: 3 });
  });
});
