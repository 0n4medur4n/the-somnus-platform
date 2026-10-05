import { describe, expect, it } from "vitest";
import { centreSquare, MAX_SOURCE_BYTES, PhotoPrepFailure, prepareProfilePhoto } from "./photo.js";

describe("centreSquare", () => {
  it("cuts the centred square out of a landscape and a portrait photo", () => {
    expect(centreSquare(4000, 3000)).toEqual({ sx: 500, sy: 0, side: 3000 });
    expect(centreSquare(3000, 4000)).toEqual({ sx: 0, sy: 500, side: 3000 });
    expect(centreSquare(512, 512)).toEqual({ sx: 0, sy: 0, side: 512 });
  });
});

describe("prepareProfilePhoto", () => {
  it("refuses a file that is not an image before reading it", async () => {
    const pdf = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
    await expect(prepareProfilePhoto(pdf)).rejects.toMatchObject({ reason: "not_an_image" });
  });

  it("refuses an image over the size limit before reading it", async () => {
    const huge = new File([new Uint8Array(MAX_SOURCE_BYTES + 1)], "huge.jpg", {
      type: "image/jpeg",
    });
    await expect(prepareProfilePhoto(huge)).rejects.toBeInstanceOf(PhotoPrepFailure);
    await expect(prepareProfilePhoto(huge)).rejects.toMatchObject({ reason: "too_large" });
  });
});
