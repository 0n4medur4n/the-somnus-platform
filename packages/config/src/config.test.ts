import { describe, expect, it, vi } from "vitest";
import { loadConfig, validateConfig } from "./config.js";

const baseEnv = {
  NODE_ENV: "development",
  SERVICE_NAME: "somnus-test",
  SERVICE_VERSION: "0.0.0",
  SERVICE_COMMIT: "local",
  PORT: "8080",
  LOG_LEVEL: "info",
  LOG_FORMAT: "json",
};

describe("loadConfig", () => {
  it("returns a frozen config with public, private, raw, and service sections", () => {
    const cfg = loadConfig({
      env: { ...baseEnv, DEFAULT_LOCALE: "es" },
      serviceName: "somnus-test",
    });
    expect(cfg.service.name).toBe("somnus-test");
    expect(cfg.service.env).toBe("development");
    expect(cfg.public).toMatchObject({ DEFAULT_LOCALE: "es" });
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.public)).toBe(true);
    expect(Object.isFrozen(cfg.private)).toBe(true);
  });

  it("rejects an invalid PORT (non-numeric) and calls fail-fast", () => {
    const logger = vi.fn();
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit-${code ?? "0"}`);
    });
    try {
      expect(() =>
        loadConfig({
          env: { ...baseEnv, PORT: "not-a-number" },
          serviceName: "somnus-test",
          logger,
        }),
      ).toThrow(/exit-1/);
      expect(exit).toHaveBeenCalledWith(1);
      expect(logger).toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });

  it("rejects an invalid LOG_LEVEL enum", () => {
    const logger = vi.fn();
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit-${code ?? "0"}`);
    });
    try {
      expect(() =>
        loadConfig({
          env: { ...baseEnv, LOG_LEVEL: "verbose" },
          serviceName: "somnus-test",
          logger,
        }),
      ).toThrow(/exit-1/);
    } finally {
      exit.mockRestore();
    }
  });

  it("rejects an invalid NODE_ENV enum", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit-${code ?? "0"}`);
    });
    try {
      expect(() =>
        loadConfig({
          env: { ...baseEnv, NODE_ENV: "qa" },
          serviceName: "somnus-test",
        }),
      ).toThrow(/exit-1/);
    } finally {
      exit.mockRestore();
    }
  });

  it("rejects an invalid DEFAULT_LOCALE (must be one of es/en/ca/fr)", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit-${code ?? "0"}`);
    });
    try {
      expect(() =>
        loadConfig({
          env: { ...baseEnv, DEFAULT_LOCALE: "de" },
          serviceName: "somnus-test",
        }),
      ).toThrow(/exit-1/);
    } finally {
      exit.mockRestore();
    }
  });

  it("rejects an invalid APP_BASE_URL (not a URL)", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit-${code ?? "0"}`);
    });
    try {
      expect(() =>
        loadConfig({
          env: { ...baseEnv, APP_BASE_URL: "not a url" },
          serviceName: "somnus-test",
        }),
      ).toThrow(/exit-1/);
    } finally {
      exit.mockRestore();
    }
  });

  it("keeps unknown env vars in the private section", () => {
    const cfg = loadConfig({
      env: { ...baseEnv, DATABASE_URL: "mysql://x", JWT_SECRET: "shh" },
      serviceName: "somnus-test",
    });
    expect(cfg.private["DATABASE_URL"]).toBe("mysql://x");
    expect(cfg.private["JWT_SECRET"]).toBe("shh");
    expect(cfg.public).not.toHaveProperty("DATABASE_URL");
    expect(cfg.public).not.toHaveProperty("JWT_SECRET");
  });

  it("defaults NODE_ENV to development when missing", () => {
    const env = { ...baseEnv };
    delete (env as Record<string, string | undefined>).NODE_ENV;
    const cfg = loadConfig({ env, serviceName: "somnus-test" });
    expect(cfg.service.env).toBe("development");
  });

  it("coerces PORT to a number", () => {
    const cfg = loadConfig({
      env: { ...baseEnv, PORT: "9090" },
      serviceName: "somnus-test",
    });
    expect(cfg.private["PORT"]).toBe(9090);
  });

  it("rejects an empty SERVICE_NAME", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit-${code ?? "0"}`);
    });
    try {
      expect(() =>
        loadConfig({
          env: { ...baseEnv, SERVICE_NAME: "" },
          serviceName: "somnus-test",
        }),
      ).toThrow(/exit-1/);
    } finally {
      exit.mockRestore();
    }
  });

  it("parseInt: SUPPORTED_LOCALES is split on commas", () => {
    const cfg = loadConfig({
      env: { ...baseEnv, SUPPORTED_LOCALES: "es, ca , fr" },
      serviceName: "somnus-test",
    });
    expect(cfg.public["SUPPORTED_LOCALES"]).toEqual(["es", "ca", "fr"]);
  });
});

describe("validateConfig", () => {
  it("returns ok for a valid env", () => {
    const r = validateConfig(baseEnv);
    expect(r.success).toBe(true);
  });
  it("returns failure with detailed issues for an invalid env", () => {
    const r = validateConfig({ ...baseEnv, PORT: "abc" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.length).toBeGreaterThan(0);
    }
  });
});
