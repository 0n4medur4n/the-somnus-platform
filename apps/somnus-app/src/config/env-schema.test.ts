import { describe, expect, it } from "vitest";
import { HostingEnvSchema } from "./env-schema.js";

const valid = {
  VITE_EDGE_API_URL: "https://edge.example.com",
  VITE_FIREBASE_API_KEY: `AIza${"a".repeat(35)}`,
  VITE_FIREBASE_AUTH_DOMAIN: "somnus-test.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "somnus-test",
};

describe("Hosting configuration", () => {
  it("requires every public setting", () => {
    expect(HostingEnvSchema.safeParse(valid).success).toBe(true);
    for (const key of Object.keys(valid)) {
      const input: Record<string, string> = { ...valid };
      delete input[key];
      expect(HostingEnvSchema.safeParse(input).success).toBe(false);
    }
  });
  it.each([
    { VITE_EDGE_API_URL: "http://localhost:8080" },
    { VITE_EDGE_API_URL: "https://user:password@edge.example.com" },
    { VITE_FIREBASE_API_KEY: "demo-api-key" },
    { VITE_FIREBASE_AUTH_DOMAIN: "another-project.firebaseapp.com" },
    { VITE_AUTH_EMULATOR_URL: "http://127.0.0.1:9099" },
  ])("rejects invalid deployed configuration %o", (override) => {
    expect(HostingEnvSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});
