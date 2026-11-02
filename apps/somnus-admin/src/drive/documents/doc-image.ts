import { Image } from "@tiptap/extension-image";

/**
 * Pictures in a Drive document (owner decision 2026-11-02): our logos, or an
 * image from the computer. A picture lives inside the document, as a data URL,
 * so it is encrypted with it; nothing is ever fetched from anywhere. An image
 * pointing elsewhere (pasted, or written into a document by hand) is not
 * shown at all: a remote picture would tell its server who opened the file.
 */
const SAFE_SRC = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

export function safeImageSrc(src: unknown): string | null {
  return typeof src === "string" && SAFE_SRC.test(src) ? src : null;
}

/** The largest picture kept, in bytes of its data URL; larger ones are scaled down first. */
export const IMAGE_MAX_CHARS = 1_500_000;

export const IMAGE_WIDTHS = [25, 50, 75, 100] as const;
export type ImageAlign = "left" | "center" | "right";

export const SomnusImage = Image.extend({
  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => safeImageSrc(element.getAttribute("src")),
        renderHTML: (attributes) => {
          const src = safeImageSrc(attributes["src"]);
          return src ? { src } : {};
        },
      },
      alt: { default: null },
      /** Share of the page's width, in percent. */
      width: {
        default: 50,
        parseHTML: (element) => {
          const value = Number(element.getAttribute("data-width"));
          return value >= 5 && value <= 100 ? value : 50;
        },
        renderHTML: (attributes) => ({
          "data-width": String(attributes["width"] ?? 50),
          style: `width:${Number(attributes["width"]) || 50}%`,
        }),
      },
      align: {
        default: "center",
        parseHTML: (element) => {
          const value = element.getAttribute("data-align");
          return value === "left" || value === "right" ? value : "center";
        },
        renderHTML: (attributes) => {
          const align = String(attributes["align"] ?? "center");
          const margin =
            align === "left"
              ? "margin-right:auto"
              : align === "right"
                ? "margin-left:auto"
                : "margin-left:auto;margin-right:auto";
          return { "data-align": align, style: margin };
        },
      },
      /** The picture's own size, for exports that need a height. */
      naturalWidth: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute("data-nw")) || null,
        renderHTML: (attributes) =>
          attributes["naturalWidth"] ? { "data-nw": String(attributes["naturalWidth"]) } : {},
      },
      naturalHeight: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute("data-nh")) || null,
        renderHTML: (attributes) =>
          attributes["naturalHeight"] ? { "data-nh": String(attributes["naturalHeight"]) } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: 'img[src^="data:image/"]' }];
  },
}).configure({ inline: false, allowBase64: true });

/** A picture from a file, as a data URL no larger than the limit, and its size. */
export async function imageFromFile(
  file: Blob,
): Promise<{ src: string; width: number; height: number } | null> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return null;
  const url = URL.createObjectURL(file);
  try {
    const picture = new window.Image();
    picture.src = url;
    await picture.decode();
    let { naturalWidth: width, naturalHeight: height } = picture;
    // Large photos are scaled to 1600 px across: plenty for a page, and small to store.
    const scale = Math.min(1, 1600 / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(picture, 0, 0, width, height);
    let src = canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.85);
    if (src.length > IMAGE_MAX_CHARS) src = canvas.toDataURL("image/jpeg", 0.7);
    return src.length > IMAGE_MAX_CHARS || !safeImageSrc(src) ? null : { src, width, height };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One of our logos, served by the console itself, as a picture for a document. */
export async function logoImage(
  path: string,
): Promise<{ src: string; width: number; height: number } | null> {
  const response = await fetch(path);
  if (!response.ok) return null;
  return imageFromFile(await response.blob());
}

/** The logos offered in documents, as files the console serves. */
export const LOGOS = [
  { key: "somnus", path: "/brand/somnus-logo.png" },
  { key: "somnusDark", path: "/brand/somnus-logo-fondo.png" },
  { key: "morpheo", path: "/brand/morpheo-logo.png" },
  { key: "morpheoDark", path: "/brand/morpheo-logo-fondo.png" },
] as const;
