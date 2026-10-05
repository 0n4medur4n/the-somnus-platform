import { ErrorCode } from "@somnus/errors";
import { describe, expect, it } from "vitest";
import {
  createProfilePhotoStore,
  GcsProfilePhotoStore,
  InMemoryProfilePhotoStore,
  UnconfiguredProfilePhotoStore,
} from "../../src/infrastructure/storage/profile-photo-store.js";
import {
  inspectProfilePhoto,
  PROFILE_PHOTO_MAX_BYTES,
} from "../../src/modules/me/profile-photo.js";
import { jpeg, webp } from "../support/images.js";

describe("inspectProfilePhoto", () => {
  it("accepts a WebP and a JPEG as the app re-encodes them", () => {
    expect(inspectProfilePhoto(webp(), "image/webp")).toEqual({ ok: true, type: "image/webp" });
    expect(inspectProfilePhoto(jpeg(), "image/jpeg")).toEqual({ ok: true, type: "image/jpeg" });
  });

  it("accepts a WebP with transparency and a colour profile", () => {
    const withAlpha = webp([
      ["ALPH", Buffer.from([0])],
      ["ICCP", Buffer.from([1, 2])],
    ]);
    expect(inspectProfilePhoto(withAlpha, "image/webp").ok).toBe(true);
  });

  it.each([
    ["EXIF", "a WebP carrying EXIF (where a phone stores the GPS position)"],
    ["XMP ", "a WebP carrying XMP"],
    ["ANIM", "an animated WebP"],
  ])("rejects %s: %s", (fourcc) => {
    const photo = webp([[fourcc, Buffer.from("GPS 41.38N 2.17E", "latin1")]]);
    expect(inspectProfilePhoto(photo, "image/webp")).toEqual({
      ok: false,
      reason: "unsafe_structure",
    });
  });

  it("rejects a JPEG that still carries EXIF", () => {
    expect(inspectProfilePhoto(jpeg({ exif: true }), "image/jpeg")).toEqual({
      ok: false,
      reason: "unsafe_structure",
    });
  });

  it("rejects truncated files", () => {
    const whole = webp();
    expect(inspectProfilePhoto(whole.subarray(0, whole.length - 3), "image/webp").ok).toBe(false);
    expect(inspectProfilePhoto(jpeg().subarray(0, 10), "image/jpeg").ok).toBe(false);
  });

  it("rejects anything that is not a WebP or JPEG, whatever it claims to be", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    expect(inspectProfilePhoto(png, "image/webp")).toEqual({ ok: false, reason: "not_an_image" });
    expect(inspectProfilePhoto(html, "image/jpeg")).toEqual({ ok: false, reason: "not_an_image" });
  });

  it("rejects bytes that do not match the declared type", () => {
    expect(inspectProfilePhoto(jpeg(), "image/webp")).toEqual({
      ok: false,
      reason: "type_mismatch",
    });
  });

  it("rejects a file over 1 MB", () => {
    const big = Buffer.concat([webp(), Buffer.alloc(PROFILE_PHOTO_MAX_BYTES)]);
    expect(inspectProfilePhoto(big, "image/webp")).toEqual({ ok: false, reason: "too_large" });
  });
});

describe("createProfilePhotoStore", () => {
  it("uses the private bucket when one is configured", () => {
    expect(createProfilePhotoStore("somnus-profile-photos", "production")).toBeInstanceOf(
      GcsProfilePhotoStore,
    );
  });

  it("keeps photos in memory for local development and tests", () => {
    expect(createProfilePhotoStore(undefined, "development")).toBeInstanceOf(
      InMemoryProfilePhotoStore,
    );
  });

  it("refuses uploads in production without a bucket, but never blocks account erasure", async () => {
    const store = createProfilePhotoStore(undefined, "production");
    expect(store).toBeInstanceOf(UnconfiguredProfilePhotoStore);
    await expect(store.put("u", { bytes: webp(), type: "image/webp" })).rejects.toMatchObject({
      code: ErrorCode.CONFIGURATION_INVALID,
    });
    await expect(store.remove("u")).resolves.toBeUndefined();
  });

  it("the in-memory store keeps one photo per person and forgets it on removal", async () => {
    const store = new InMemoryProfilePhotoStore();
    await store.put("a", { bytes: webp(), type: "image/webp" });
    await store.put("a", { bytes: jpeg(), type: "image/jpeg" });
    expect((await store.get("a"))?.type).toBe("image/jpeg");
    expect(await store.get("b")).toBeNull();
    await store.remove("a");
    await store.remove("a");
    expect(await store.get("a")).toBeNull();
  });
});
