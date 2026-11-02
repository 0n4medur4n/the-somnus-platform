/**
 * Our fonts as files (owner decision 2026-11-02: documents are written in the
 * brand's letters). The console serves them from its own Hosting, so the
 * editor shows them, a PDF embeds them and an HTML export carries them; nothing
 * is fetched from anywhere else. Okine has no italic: its italic is the upright.
 */
export const FONT_FILES = {
  Satoshi: {
    normal: "/fonts/satoshi/Satoshi-Regular.otf",
    bold: "/fonts/satoshi/Satoshi-Bold.otf",
    italics: "/fonts/satoshi/Satoshi-Italic.otf",
    bolditalics: "/fonts/satoshi/Satoshi-BoldItalic.otf",
  },
  Okine: {
    normal: "/fonts/okine/MADEOkineSansPERSONALUSE-Regular.otf",
    bold: "/fonts/okine/MADEOkineSansPERSONALUSE-Bold.otf",
    italics: "/fonts/okine/MADEOkineSansPERSONALUSE-Regular.otf",
    bolditalics: "/fonts/okine/MADEOkineSansPERSONALUSE-Bold.otf",
  },
} as const;

export type BrandFont = keyof typeof FONT_FILES;
/** File path -> bytes, for the files that could be read. */
export type FontBytes = ReadonlyMap<string, Uint8Array>;

export function isBrandFont(name: string | null | undefined): name is BrandFont {
  return name === "Satoshi" || name === "Okine";
}

/** The files of `fonts`, read from the console's own origin; a file that fails is left out. */
export async function loadFonts(fonts: Iterable<BrandFont>): Promise<FontBytes> {
  const paths = new Set<string>();
  for (const font of fonts) for (const path of Object.values(FONT_FILES[font])) paths.add(path);
  const out = new Map<string, Uint8Array>();
  await Promise.all(
    [...paths].map(async (path) => {
      try {
        const response = await fetch(path);
        if (response.ok) out.set(path, new Uint8Array(await response.arrayBuffer()));
      } catch {
        // The export goes ahead in a font every reader has.
      }
    }),
  );
  return out;
}

/** True when every file of `font` is in `bytes`. */
export function hasFont(bytes: FontBytes, font: BrandFont): boolean {
  return Object.values(FONT_FILES[font]).every((path) => bytes.has(path));
}
