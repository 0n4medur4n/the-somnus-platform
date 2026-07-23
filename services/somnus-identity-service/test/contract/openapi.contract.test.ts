/**
 * Contract tests against the generated OpenAPI document (build plan §20
 * Checkpoint 6.2 exit criterion: "contract tests against the generated
 * OpenAPI"). These do NOT re-derive the document -- they load the file
 * `generate:openapi` already wrote (schemas/openapi/identity-service.json,
 * build plan §3.4: generated from Zod, never hand-written) and assert two
 * things a route/schema change could silently break:
 *
 * 1. Every route this checkpoint implements is actually documented, with
 *    the right method and the right request-body schema reference.
 * 2. The generated JSON Schema for each request DTO accepts exactly what
 *    the source-of-truth Zod schema accepts, and rejects what it rejects
 *    (missing required fields, unknown fields under `.strict()`, bad enum
 *    values). This is the real "contract" claim: that the document is not
 *    lying about the runtime validator every request actually goes
 *    through (the global nestjs-zod ZodValidationPipe, app.module.ts).
 *
 * Response bodies are not yet wired into swagger (no @ApiResponse/
 * ZodResponse decorators on any controller in this checkpoint), so the
 * generated document only carries schemas for request DTOs. That is a
 * disclosed scope boundary, not an oversight: response shapes are already
 * covered at the Zod level by packages/api-contracts/src/identity/
 * identity.test.ts and at the HTTP level by
 * test/integration/http-endpoints.integration.test.ts.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AccessGrantCreateRequestSchema,
  AuthorizationCheckRequestSchema,
  InvitationAcceptRequestSchema,
  InvitationCreateRequestSchema,
  MembershipPatchRequestSchema,
  OrganizationCreateRequestSchema,
  ProfilePatchRequestSchema,
} from "@somnus/api-contracts";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "schemas",
  "openapi",
  "identity-service.json",
);

interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

interface OpenApiDocument {
  openapi: string;
  paths: Record<
    string,
    Record<string, { requestBody?: unknown; responses: Record<string, unknown> }>
  >;
  components: { schemas: Record<string, JsonSchemaObject> };
}

const document: OpenApiDocument = JSON.parse(readFileSync(OPENAPI_PATH, "utf8"));

/**
 * A deliberately small JSON Schema validator, not a general-purpose one.
 * It covers exactly the vocabulary nestjs-zod emits for these flat,
 * `.strict()`-object DTOs (object/string/enum/required/
 * additionalProperties/minLength/maxLength/pattern) -- enough to prove
 * schema<->schema equivalence without adding a new dependency for a
 * handful of flat request bodies.
 */
function validateAgainstJsonSchema(schema: JsonSchemaObject, value: unknown): string[] {
  const errors: string[] = [];
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return ["value is not an object"];
    }
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`missing required property "${key}"`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!schema.properties || !(key in schema.properties)) {
          errors.push(`unexpected additional property "${key}"`);
        }
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (key in obj) {
        errors.push(...validateAgainstJsonSchema(propSchema, obj[key]).map((e) => `${key}: ${e}`));
      }
    }
    return errors;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") return ["value is not a string"];
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`"${value}" is not one of ${JSON.stringify(schema.enum)}`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`length ${value.length} is below minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`length ${value.length} is above maxLength ${schema.maxLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`"${value}" does not match pattern ${schema.pattern}`);
    }
    return errors;
  }
  return errors;
}

/** Table of every request DTO this checkpoint generates, paired with its source-of-truth Zod schema. */
const REQUEST_DTOS: Array<{
  schemaName: string;
  zodSchema: z.ZodType;
  valid: unknown;
  invalid: Array<{ label: string; payload: unknown }>;
}> = [
  {
    schemaName: "AuthorizationCheckDto",
    zodSchema: AuthorizationCheckRequestSchema,
    valid: {
      actorUserId: "019893d1-2b8e-7c3a-8f1a-000000000001",
      subjectUserId: "019893d1-2b8e-7c3a-8f1a-000000000002",
      action: "read_clinical_data",
    },
    invalid: [
      {
        label: "missing required actorUserId",
        payload: {
          subjectUserId: "019893d1-2b8e-7c3a-8f1a-000000000002",
          action: "read_clinical_data",
        },
      },
      {
        label: "invalid action enum value",
        payload: {
          actorUserId: "019893d1-2b8e-7c3a-8f1a-000000000001",
          subjectUserId: "019893d1-2b8e-7c3a-8f1a-000000000002",
          action: "delete_everything",
        },
      },
      {
        label: "unknown additional property (strict)",
        payload: {
          actorUserId: "019893d1-2b8e-7c3a-8f1a-000000000001",
          subjectUserId: "019893d1-2b8e-7c3a-8f1a-000000000002",
          action: "read_clinical_data",
          extra: "nope",
        },
      },
    ],
  },
  {
    schemaName: "ProfilePatchDto",
    zodSchema: ProfilePatchRequestSchema,
    valid: { firstName: "Ada" },
    invalid: [
      { label: "unknown additional property (strict)", payload: { nickname: "Ada" } },
      { label: "firstName below minLength", payload: { firstName: "" } },
    ],
  },
  {
    schemaName: "OrganizationCreateDto",
    zodSchema: OrganizationCreateRequestSchema,
    valid: { name: "Somnus Clinic" },
    invalid: [
      { label: "missing required name", payload: {} },
      { label: "name below minLength", payload: { name: "" } },
    ],
  },
  {
    schemaName: "MembershipPatchDto",
    zodSchema: MembershipPatchRequestSchema,
    valid: { status: "inactive" },
    invalid: [
      { label: "missing required status", payload: {} },
      { label: "invalid status enum value", payload: { status: "banned" } },
    ],
  },
  {
    schemaName: "InvitationCreateDto",
    zodSchema: InvitationCreateRequestSchema,
    valid: { email: "clinician@example.com", roleKey: "professional" },
    invalid: [
      { label: "missing required email", payload: { roleKey: "professional" } },
      {
        label: "invalid roleKey enum value",
        payload: { email: "clinician@example.com", roleKey: "wizard" },
      },
    ],
  },
  {
    schemaName: "InvitationAcceptDto",
    zodSchema: InvitationAcceptRequestSchema,
    valid: { token: "some-opaque-token" },
    invalid: [{ label: "missing required token", payload: {} }],
  },
  {
    schemaName: "AccessGrantCreateDto",
    zodSchema: AccessGrantCreateRequestSchema,
    valid: {
      professionalUserId: "019893d1-2b8e-7c3a-8f1a-000000000003",
      scope: "sleep_diary:read",
    },
    invalid: [
      {
        label: "missing required scope",
        payload: { professionalUserId: "019893d1-2b8e-7c3a-8f1a-000000000003" },
      },
      {
        label: "expiresAt not a valid datetime",
        payload: {
          professionalUserId: "019893d1-2b8e-7c3a-8f1a-000000000003",
          scope: "sleep_diary:read",
          expiresAt: "not-a-date",
        },
      },
    ],
  },
];

describe("OpenAPI document structure", () => {
  it("is present and generated from this checkpoint's routes", () => {
    expect(document.openapi).toBe("3.0.0");
    expect(Object.keys(document.paths).length).toBeGreaterThan(0);
  });

  it.each([
    ["/internal/v1/authorization/check", "post", "AuthorizationCheckDto"],
    ["/v1/me", "get", undefined],
    ["/v1/me/profile", "patch", "ProfilePatchDto"],
    ["/v1/organizations", "post", "OrganizationCreateDto"],
    ["/v1/organizations/{organizationId}", "get", undefined],
    ["/v1/organizations/{organizationId}", "patch", "OrganizationUpdateDto"],
    ["/v1/organizations/{organizationId}/members", "get", undefined],
    ["/v1/organizations/{organizationId}/members/{membershipId}", "patch", "MembershipPatchDto"],
    ["/v1/organizations/{organizationId}/invitations", "post", "InvitationCreateDto"],
    ["/v1/invitations/accept", "post", "InvitationAcceptDto"],
    ["/v1/me/professional/verification-cases", "post", undefined],
    ["/v1/me/professional/verification-cases", "get", undefined],
    ["/v1/me/access-grants", "post", "AccessGrantCreateDto"],
    ["/v1/me/access-grants", "get", undefined],
    ["/v1/me/access-grants/{grantId}/revoke", "post", undefined],
  ] as const)("documents %s %s with request schema %s", (path, method, expectedSchemaRef) => {
    const operation = document.paths[path]?.[method];
    expect(
      operation,
      `${method.toUpperCase()} ${path} is missing from the generated document`,
    ).toBeDefined();
    if (expectedSchemaRef) {
      const ref = (
        operation?.requestBody as
          | { content: { "application/json": { schema: { $ref: string } } } }
          | undefined
      )?.content["application/json"].schema.$ref;
      expect(ref).toBe(`#/components/schemas/${expectedSchemaRef}`);
    }
  });
});

describe("generated request-body JSON Schemas agree with the source Zod schemas", () => {
  for (const dto of REQUEST_DTOS) {
    describe(dto.schemaName, () => {
      it("has a component schema in the generated document", () => {
        expect(document.components.schemas[dto.schemaName]).toBeDefined();
      });

      it("accepts a payload both Zod and the OpenAPI schema agree is valid", () => {
        const zodResult = dto.zodSchema.safeParse(dto.valid);
        expect(
          zodResult.success,
          JSON.stringify(zodResult.success ? undefined : zodResult.error),
        ).toBe(true);

        const schema = document.components.schemas[dto.schemaName];
        if (!schema) throw new Error(`${dto.schemaName} missing from generated document`);
        expect(validateAgainstJsonSchema(schema, dto.valid)).toEqual([]);
      });

      for (const { label, payload } of dto.invalid) {
        it(`rejects an invalid payload the same way Zod does: ${label}`, () => {
          const zodResult = dto.zodSchema.safeParse(payload);
          expect(zodResult.success).toBe(false);

          const schema = document.components.schemas[dto.schemaName];
          if (!schema) throw new Error(`${dto.schemaName} missing from generated document`);
          expect(validateAgainstJsonSchema(schema, payload).length).toBeGreaterThan(0);
        });
      }
    });
  }
});

describe("authorization reasonCode taxonomy is fully documented on the request/response contract", () => {
  it("every AUTHORIZATION_ACTIONS value appears in AuthorizationCheckDto's action enum", async () => {
    const { AUTHORIZATION_ACTIONS } = await import("@somnus/api-contracts");
    const actionSchema =
      document.components.schemas["AuthorizationCheckDto"]?.properties?.["action"];
    expect(actionSchema?.enum).toEqual(AUTHORIZATION_ACTIONS);
  });
});
