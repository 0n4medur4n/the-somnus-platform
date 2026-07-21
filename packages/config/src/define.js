import { z } from "zod";
export function definePublicField(key, schema, description) {
  return Object.freeze({ key, schema, description });
}
export function defineConfig(fields) {
  const shape = {};
  for (const f of fields) {
    shape[f.key] = f.schema;
  }
  return {
    schema: z.object(shape),
    keys: Object.freeze(fields.map((f) => f.key)),
  };
}
//# sourceMappingURL=define.js.map
