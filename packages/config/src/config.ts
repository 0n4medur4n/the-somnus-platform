import { type ZodError, z } from "zod";

export interface LoadOptions {
  env?: NodeJS.ProcessEnv;
  serviceName: string;
  failOnInvalid?: boolean;
  logger?: (line: string) => void;
}

export type SomnusConfig = {
  readonly raw: Readonly<Record<string, string>>;
  readonly public: Readonly<Record<string, unknown>>;
  readonly private: Readonly<Record<string, unknown>>;
  readonly service: { name: string; env: string; version: string; commit: string };
};

export type PublicConfig = Readonly<Record<string, unknown>>;

export const SomnusConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  SERVICE_NAME: z.string().min(1),
  SERVICE_VERSION: z.string().min(1).default("0.0.0"),
  SERVICE_COMMIT: z.string().min(1).default("local"),
  PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_FORMAT: z.enum(["json", "text"]).default("json"),
});

export const PublicConfigSchema = z.object({
  DEFAULT_LOCALE: z.enum(["es", "en", "ca", "fr"]).default("es"),
  SUPPORTED_LOCALES: z
    .string()
    .default("es,en,ca,fr")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  APP_BASE_URL: z.string().url().optional(),
});

export function validateConfig(env: NodeJS.ProcessEnv): z.ZodSafeParseResult<{
  base: z.infer<typeof SomnusConfigSchema>;
  public: z.infer<typeof PublicConfigSchema>;
}> {
  const baseResult = SomnusConfigSchema.safeParse(env);
  const publicResult = PublicConfigSchema.safeParse(env);
  if (!baseResult.success) return baseResult;
  if (!publicResult.success) return publicResult;
  return {
    success: true,
    data: {
      base: baseResult.data,
      public: publicResult.data,
    },
  };
}

function formatZodError(err: ZodError): string {
  return err.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

function splitPublicPrivate(
  parsed: { base: z.infer<typeof SomnusConfigSchema>; public: z.infer<typeof PublicConfigSchema> },
  env: NodeJS.ProcessEnv,
): {
  publicConfig: PublicConfig;
  privateConfig: Readonly<Record<string, unknown>>;
} {
  const publicConfig: Record<string, unknown> = {};
  for (const key of Object.keys(parsed.public)) {
    publicConfig[key] = (parsed.public as Record<string, unknown>)[key];
  }
  const known = new Set([
    ...Object.keys(SomnusConfigSchema.shape),
    ...Object.keys(PublicConfigSchema.shape),
  ]);
  const privateConfig: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(env)) {
    if (!known.has(k)) {
      privateConfig[k] = v;
    }
  }
  privateConfig["NODE_ENV"] = parsed.base.NODE_ENV;
  privateConfig["PORT"] = parsed.base.PORT;
  privateConfig["LOG_LEVEL"] = parsed.base.LOG_LEVEL;
  privateConfig["LOG_FORMAT"] = parsed.base.LOG_FORMAT;
  return { publicConfig, privateConfig };
}

export function loadConfig(options: LoadOptions): SomnusConfig {
  const env = options.env ?? process.env;
  const result = validateConfig(env);
  const log = options.logger ?? ((line) => console.error(line));
  if (!result.success) {
    log(
      `[config] FATAL: invalid configuration for service "${options.serviceName}":\n${formatZodError(result.error)}`,
    );
    if (options.failOnInvalid !== false) {
      process.exit(1);
    }
    throw new Error("Invalid configuration");
  }
  const { publicConfig, privateConfig } = splitPublicPrivate(result.data, env);
  return Object.freeze({
    raw: Object.freeze({ ...env }),
    public: Object.freeze(publicConfig),
    private: Object.freeze(privateConfig),
    service: Object.freeze({
      name: options.serviceName,
      env: result.data.base.NODE_ENV,
      version: result.data.base.SERVICE_VERSION,
      commit: result.data.base.SERVICE_COMMIT,
    }),
  });
}
