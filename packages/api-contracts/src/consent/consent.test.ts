import { describe, expect, it } from "vitest";
import { UUIDv7 } from "../uuid.js";
import { ConsentCheckRequestSchema, ConsentCheckResponseSchema } from "./consent-check.js";
import { CONSENT_PURPOSE_KEYS, ConsentPurposeKeySchema } from "./consent-purpose.js";
import {
  ConsentCreateRequestSchema,
  ConsentReceiptSchema,
  ConsentStatusListResponseSchema,
  ConsentStatusSchema,
  ConsentWithdrawRequestSchema,
} from "./consent-receipt.js";
import {
  CurrentLegalDocumentsResponseSchema,
  LegalDocumentVersionSchema,
} from "./legal-document.js";

describe("ConsentPurposeKeySchema", () => {
  it("accepts every documented purpose key", () => {
    for (const key of CONSENT_PURPOSE_KEYS) {
      expect(ConsentPurposeKeySchema.safeParse(key).success).toBe(true);
    }
  });

  it("rejects an unknown purpose key", () => {
    expect(ConsentPurposeKeySchema.safeParse("newsletter").success).toBe(false);
  });
});

describe("LegalDocumentVersionSchema", () => {
  it("accepts a valid version", () => {
    const r = LegalDocumentVersionSchema.safeParse({
      id: UUIDv7(),
      purposeKey: "privacy_policy_acknowledgement",
      version: 1,
      locale: "es",
      content: "...",
      effectiveAt: new Date().toISOString(),
    });
    expect(r.success).toBe(true);
  });
});

describe("CurrentLegalDocumentsResponseSchema", () => {
  it("accepts an empty document list", () => {
    expect(CurrentLegalDocumentsResponseSchema.safeParse({ documents: [] }).success).toBe(true);
  });
});

describe("ConsentCreateRequestSchema", () => {
  it("accepts a minimal request and defaults source", () => {
    const r = ConsentCreateRequestSchema.safeParse({ purposeKey: "marketing" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.source).toBe("app");
  });

  it("rejects unknown keys", () => {
    expect(
      ConsentCreateRequestSchema.safeParse({ purposeKey: "marketing", token: "x" }).success,
    ).toBe(false);
  });
});

describe("ConsentWithdrawRequestSchema", () => {
  it("accepts an empty body (reason is optional)", () => {
    expect(ConsentWithdrawRequestSchema.safeParse({}).success).toBe(true);
  });
});

describe("ConsentReceiptSchema", () => {
  it("accepts a receipt with no organization/withdrawal", () => {
    const r = ConsentReceiptSchema.safeParse({
      id: UUIDv7(),
      userId: UUIDv7(),
      purposeKey: "health_data_processing",
      legalDocumentVersionId: UUIDv7(),
      source: "app",
      consentedAt: new Date().toISOString(),
    });
    expect(r.success).toBe(true);
  });
});

describe("ConsentStatusSchema / ConsentStatusListResponseSchema", () => {
  it("every purpose round-trips through the status list response", () => {
    const purposes = CONSENT_PURPOSE_KEYS.map((purposeKey) =>
      ConsentStatusSchema.parse({
        purposeKey,
        consented: false,
        current: false,
        withdrawn: false,
      }),
    );
    expect(ConsentStatusListResponseSchema.safeParse({ purposes }).success).toBe(true);
  });
});

describe("ConsentCheckRequestSchema / ConsentCheckResponseSchema", () => {
  it("accepts a valid check request and response", () => {
    expect(
      ConsentCheckRequestSchema.safeParse({
        userId: UUIDv7(),
        purposeKey: "health_data_processing",
      }).success,
    ).toBe(true);
    expect(
      ConsentCheckResponseSchema.safeParse({ consented: true, withdrawn: false }).success,
    ).toBe(true);
  });

  it("rejects an unknown purposeKey", () => {
    expect(
      ConsentCheckRequestSchema.safeParse({ userId: UUIDv7(), purposeKey: "nope" }).success,
    ).toBe(false);
  });
});
