/**
 * How a folder, shared folder, note or file looks in the Drive (owner decision
 * 2026-10-29): a colour from a fixed palette and, optionally, an emoji. Both
 * live in the node's sealed metadata next to its name, so the server sees
 * neither, and both survive renames and new revisions.
 */

export const DRIVE_COLORS = [
  { key: "red", hex: "#f87171" },
  { key: "orange", hex: "#fb923c" },
  { key: "amber", hex: "#fbbf24" },
  { key: "green", hex: "#4ade80" },
  { key: "teal", hex: "#2dd4bf" },
  { key: "blue", hex: "#60a5fa" },
  { key: "indigo", hex: "#818cf8" },
  { key: "purple", hex: "#c084fc" },
  { key: "pink", hex: "#f472b6" },
  { key: "gray", hex: "#9ca3af" },
] as const;

export type DriveColor = (typeof DRIVE_COLORS)[number]["key"];

export type Appearance = { color?: DriveColor; emoji?: string };

const COLOR_KEYS: ReadonlySet<string> = new Set(DRIVE_COLORS.map((c) => c.key));

export function colorHex(color: DriveColor | undefined): string | undefined {
  return DRIVE_COLORS.find((c) => c.key === color)?.hex;
}

/** A few to pick from at a glance; any single emoji can also be typed. */
export const EMOJI_SUGGESTIONS = [
  "📁",
  "📂",
  "🗂️",
  "📋",
  "📌",
  "⭐",
  "🔒",
  "⚠️",
  "✅",
  "📄",
  "📝",
  "📑",
  "📊",
  "📈",
  "🧪",
  "🩺",
  "💊",
  "🧠",
  "😴",
  "🌙",
  "🛏️",
  "⏰",
  "💡",
  "🎯",
  "👥",
  "🤝",
  "🏥",
  "⚖️",
  "💶",
  "🛠️",
  "🚀",
  "❤️",
] as const;

/** One emoji (a single grapheme, which may be several code points), or nothing. */
export function cleanEmoji(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 16) return undefined;
  const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)];
  if (segments.length !== 1) return undefined;
  // Pictographs only: no letters, digits or punctuation passed off as an icon.
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(trimmed) ? trimmed : undefined;
}

/** What may be stored and shown: an unknown colour or a non-emoji is dropped, never trusted. */
export function cleanAppearance(value: { color?: unknown; emoji?: unknown }): Appearance {
  const color =
    typeof value.color === "string" && COLOR_KEYS.has(value.color)
      ? (value.color as DriveColor)
      : undefined;
  const emoji = cleanEmoji(value.emoji);
  return { ...(color ? { color } : {}), ...(emoji ? { emoji } : {}) };
}
