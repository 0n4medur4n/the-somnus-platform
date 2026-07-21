import { type ZodTypeAny, z } from "zod";
export type PublicFieldDefinition = {
  readonly key: string;
  readonly schema: ZodTypeAny;
  readonly description: string;
};
export type ConfigDefinition = Record<string, PublicFieldDefinition>;
export declare function definePublicField(
  key: string,
  schema: ZodTypeAny,
  description: string,
): PublicFieldDefinition;
export declare function defineConfig(fields: ReadonlyArray<PublicFieldDefinition>): {
  schema: z.ZodObject<Record<string, ZodTypeAny>>;
  keys: ReadonlyArray<string>;
};
//# sourceMappingURL=define.d.ts.map
