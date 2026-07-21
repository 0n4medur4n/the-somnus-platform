import { z } from "zod";
export interface LoadOptions {
  env?: NodeJS.ProcessEnv;
  serviceName: string;
  failOnInvalid?: boolean;
  logger?: (line: string) => void;
}
export type SomnusConfig = {
  readonly raw: Readonly<Record<string, string | undefined>>;
  readonly public: Readonly<Record<string, unknown>>;
  readonly private: Readonly<Record<string, unknown>>;
  readonly service: {
    name: string;
    env: string;
    version: string;
    commit: string;
  };
};
export type PublicConfig = Readonly<Record<string, unknown>>;
export declare const SomnusConfigSchema: z.ZodObject<
  {
    NODE_ENV: z.ZodDefault<
      z.ZodEnum<{
        development: "development";
        test: "test";
        staging: "staging";
        production: "production";
      }>
    >;
    SERVICE_NAME: z.ZodString;
    SERVICE_VERSION: z.ZodDefault<z.ZodString>;
    SERVICE_COMMIT: z.ZodDefault<z.ZodString>;
    PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    LOG_LEVEL: z.ZodDefault<
      z.ZodEnum<{
        error: "error";
        debug: "debug";
        info: "info";
        warn: "warn";
      }>
    >;
    LOG_FORMAT: z.ZodDefault<
      z.ZodEnum<{
        json: "json";
        text: "text";
      }>
    >;
  },
  z.core.$strip
>;
export declare const PublicConfigSchema: z.ZodObject<
  {
    DEFAULT_LOCALE: z.ZodDefault<
      z.ZodEnum<{
        es: "es";
        en: "en";
        ca: "ca";
        fr: "fr";
      }>
    >;
    SUPPORTED_LOCALES: z.ZodPipe<z.ZodDefault<z.ZodString>, z.ZodTransform<string[], string>>;
    APP_BASE_URL: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export type ValidatedConfig = {
  base: z.infer<typeof SomnusConfigSchema>;
  public: z.infer<typeof PublicConfigSchema>;
};
export declare function validateConfig(
  env: NodeJS.ProcessEnv,
): z.ZodSafeParseResult<ValidatedConfig>;
export declare function loadConfig(options: LoadOptions): SomnusConfig;
//# sourceMappingURL=config.d.ts.map
