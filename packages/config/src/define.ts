import { type ZodTypeAny, z } from "zod";

export type PublicFieldDefinition = {
  readonly key: string;
  readonly schema: ZodTypeAny;
  readonly description: string;
};

export type ConfigDefinition = Record<string, PublicFieldDefinition>;

export function definePublicField(
  key: string,
  schema: ZodTypeAny,
  description: string,
): PublicFieldDefinition {
  return Object.freeze({ key, schema, description });
}

export function defineConfig(fields: ReadonlyArray<PublicFieldDefinition>): {
  schema: z.ZodObject<Record<string, ZodTypeAny>>;
  keys: ReadonlyArray<string>;
} {
  const shape: Record<string, ZodTypeAny> = {};
  for (const f of fields) {
    shape[f.key] = f.schema;
  }
  return {
    schema: z.object(shape),
    keys: Object.freeze(fields.map((f) => f.key)),
  };
}
