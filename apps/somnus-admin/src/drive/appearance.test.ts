import { describe, expect, it } from "vitest";
import { cleanAppearance, colorHex, DRIVE_ICONS } from "./appearance.js";

describe("Drive appearance", () => {
  it("keeps only the palette's colours and the picker's icons", () => {
    expect(cleanAppearance({ color: "teal", icon: "stethoscope" })).toEqual({
      color: "teal",
      icon: "stethoscope",
    });
    expect(cleanAppearance({ color: "#ff0000", icon: "skull" })).toEqual({});
    expect(cleanAppearance({ color: 3, icon: 4 })).toEqual({});
    expect(colorHex("blue")).toMatch(/^#[0-9a-f]{6}$/);
    expect(colorHex(undefined)).toBeUndefined();
  });

  it("no longer reads an emoji from the earlier version", () => {
    expect(cleanAppearance({ emoji: "🩺" } as never)).toEqual({});
  });

  it("offers each icon once", () => {
    expect(new Set(DRIVE_ICONS).size).toBe(DRIVE_ICONS.length);
  });
});
