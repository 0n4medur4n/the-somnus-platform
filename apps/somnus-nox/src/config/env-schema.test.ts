import { describe, expect, it } from "vitest";
import { AppEnvSchema } from "./env-schema.js";

const firebase = {
  VITE_FIREBASE_API_KEY: "demo-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "somnus-dev-test.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "somnus-dev-test",
};

describe("AppEnvSchema", () => {
  it("requires the Firebase web config", () => {
    expect(AppEnvSchema.safeParse({}).success).toBe(false);
    expect(AppEnvSchema.safeParse(firebase).success).toBe(true);
  });

  it("rejects an emulator URL that is not a URL", () => {
    expect(
      AppEnvSchema.safeParse({ ...firebase, VITE_AUTH_EMULATOR_URL: "localhost" }).success,
    ).toBe(false);
  });
});
