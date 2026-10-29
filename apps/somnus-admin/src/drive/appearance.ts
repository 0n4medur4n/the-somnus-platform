import type { IconName } from "../components/ui/Icon.js";

/**
 * How a folder, shared folder, note or file looks in the Drive (owner
 * decisions 2026-10-29): a colour from a fixed palette and, optionally, one of
 * the console's own line icons -- not emoji, which read as unserious in a
 * clinical team's workspace. Both live in the node's sealed metadata next to
 * its name, so the server sees neither, and both survive renames and new
 * revisions.
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

/** The icons an item may wear, in the order the picker shows them. */
export const DRIVE_ICONS = [
  "folder",
  "star",
  "flag",
  "pin",
  "bookmark",
  "alert",
  "checkCircle",
  "lock",
  "key",
  "verify",
  "clipboard",
  "document",
  "book",
  "chart",
  "flask",
  "stethoscope",
  "pill",
  "brain",
  "moon",
  "bed",
  "clock",
  "calendar",
  "lightbulb",
  "target",
  "users",
  "building",
  "scale",
  "euro",
  "wrench",
  "rocket",
  "heart",
  "tag",
  "archive",
  "mail",
  "globe",
  "home",
  "briefcase",
] as const satisfies ReadonlyArray<IconName>;

export type DriveIcon = (typeof DRIVE_ICONS)[number];

export type Appearance = { color?: DriveColor; icon?: DriveIcon };

const COLOR_KEYS: ReadonlySet<string> = new Set(DRIVE_COLORS.map((c) => c.key));
const ICON_KEYS: ReadonlySet<string> = new Set(DRIVE_ICONS);

export function colorHex(color: DriveColor | undefined): string | undefined {
  return DRIVE_COLORS.find((c) => c.key === color)?.hex;
}

/**
 * What may be stored and shown: a colour or an icon outside the lists is
 * dropped, never trusted. An `emoji` written by the earlier version is simply
 * not read any more.
 */
export function cleanAppearance(value: { color?: unknown; icon?: unknown }): Appearance {
  const color =
    typeof value.color === "string" && COLOR_KEYS.has(value.color)
      ? (value.color as DriveColor)
      : undefined;
  const icon =
    typeof value.icon === "string" && ICON_KEYS.has(value.icon)
      ? (value.icon as DriveIcon)
      : undefined;
  return { ...(color ? { color } : {}), ...(icon ? { icon } : {}) };
}
