import { describe, expect, it } from "vitest";
import { cleanAppearance, cleanEmoji, colorHex } from "./appearance.js";

describe("Drive appearance", () => {
  it.each(["📁", "👍🏽", "🇪🇸", "❤️", "👩‍⚕️"])("accepts the single emoji %s", (emoji) => {
    expect(cleanEmoji(emoji)).toBe(emoji);
  });

  it.each(["", "a", "AB", "1", "📁📁", "<b>", "javascript:", "  ", "😴 x"])(
    "refuses %j as an icon",
    (value) => {
      expect(cleanEmoji(value)).toBeUndefined();
    },
  );

  it("keeps only the palette's colours", () => {
    expect(cleanAppearance({ color: "teal", emoji: "🩺" })).toEqual({ color: "teal", emoji: "🩺" });
    expect(cleanAppearance({ color: "#ff0000" })).toEqual({});
    expect(cleanAppearance({ color: 3, emoji: 4 })).toEqual({});
    expect(colorHex("blue")).toMatch(/^#[0-9a-f]{6}$/);
    expect(colorHex(undefined)).toBeUndefined();
  });
});
