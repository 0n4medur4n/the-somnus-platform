import type { JSONContent } from "@tiptap/core";
import { generateHTML } from "@tiptap/core";
import {
  type BrandFont,
  FONT_FILES,
  type FontBytes,
  hasFont,
  isBrandFont,
  loadFonts,
} from "./doc-fonts.js";
import {
  DEFAULT_FONT,
  DEFAULT_FONT_SIZE,
  documentExtensions,
  fontNameOf,
  hexOf,
  pointsOf,
} from "./doc-format.js";

/**
 * A Drive document, saved as a file in another format. Everything happens in
 * this browser, from the decrypted document already on screen: nothing is sent
 * anywhere to be converted. The heavy writers (Word, PDF) are loaded only when
 * someone exports, so the console does not carry them otherwise. Word and PDF
 * files can carry a password, asked for when they are opened.
 */
export const EXPORT_FORMATS = ["docx", "pdf", "html", "md", "txt"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
/** The formats that can carry a password. */
export const PASSWORD_FORMATS = ["docx", "pdf"] as const satisfies readonly ExportFormat[];

export const EXPORT_MIME: Record<ExportFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  html: "text/html",
  md: "text/markdown",
  txt: "text/plain",
};

type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
  lineBreak?: boolean;
  /** #rrggbb */
  color?: string;
  /** #rrggbb */
  highlight?: string;
  font?: string;
  /** points */
  size?: number;
  script?: "sub" | "super";
};

type Align = "left" | "center" | "right" | "justify";

function runsOf(node: JSONContent): Run[] {
  const runs: Run[] = [];
  for (const child of node.content ?? []) {
    if (child.type === "hardBreak") {
      runs.push({ text: "", lineBreak: true });
      continue;
    }
    if (child.type !== "text" || !child.text) continue;
    const run: Run = { text: child.text };
    for (const mark of child.marks ?? []) {
      if (mark.type === "bold") run.bold = true;
      else if (mark.type === "italic") run.italic = true;
      else if (mark.type === "underline") run.underline = true;
      else if (mark.type === "strike") run.strike = true;
      else if (mark.type === "code") run.code = true;
      else if (mark.type === "link" && typeof mark.attrs?.["href"] === "string") {
        run.link = mark.attrs["href"] as string;
      } else if (mark.type === "subscript") run.script = "sub";
      else if (mark.type === "superscript") run.script = "super";
      else if (mark.type === "highlight") {
        run.highlight = hexOf(mark.attrs?.["color"]) ?? "#fff2a8";
      } else if (mark.type === "textStyle") {
        const color = hexOf(mark.attrs?.["color"]);
        const font = fontNameOf(mark.attrs?.["fontFamily"]);
        const size = pointsOf(mark.attrs?.["fontSize"]);
        if (color) run.color = color;
        if (font) run.font = font;
        if (size) run.size = size;
      }
    }
    runs.push(run);
  }
  return runs;
}

function alignOf(node: JSONContent): Align {
  const value = node.attrs?.["textAlign"];
  return value === "center" || value === "right" || value === "justify" ? value : "left";
}

/** What starts a list item in plain text: a bullet, its number, or a box. */
function markerOf(list: JSONContent, item: JSONContent, index: number, bullet: string): string {
  if (list.type === "orderedList") return `${index + 1}. `;
  if (list.type === "taskList") return item.attrs?.["checked"] === true ? "☑ " : "☐ ";
  return bullet;
}

/** The brand fonts a document uses, its default included. */
export function fontsUsed(content: JSONContent): Set<BrandFont> {
  const used = new Set<BrandFont>([DEFAULT_FONT]);
  const visit = (node: JSONContent) => {
    for (const mark of node.marks ?? []) {
      const name = fontNameOf(mark.attrs?.["fontFamily"]);
      if (mark.type === "textStyle" && isBrandFont(name)) used.add(name);
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(content);
  return used;
}

function plain(node: JSONContent): string {
  return runsOf(node)
    .map((r) => (r.lineBreak ? "\n" : r.text))
    .join("");
}

// --- plain text --------------------------------------------------------------

function textBlocks(nodes: JSONContent[], indent = ""): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "paragraph":
      case "heading":
        out.push(indent + plain(node));
        break;
      case "bulletList":
      case "orderedList":
      case "taskList":
        (node.content ?? []).forEach((item, index) => {
          const marker = markerOf(node, item, index, "• ");
          const [first, ...rest] = textBlocks(item.content ?? [], `${indent}   `);
          out.push(`${indent}${marker}${(first ?? "").trimStart()}`, ...rest);
        });
        break;
      case "blockquote":
        out.push(...textBlocks(node.content ?? [], `${indent}> `));
        break;
      case "codeBlock":
        out.push(plain(node));
        break;
      case "horizontalRule":
        out.push("----------");
        break;
      case "table":
        for (const row of node.content ?? []) {
          out.push(
            (row.content ?? []).map((cell) => textBlocks(cell.content ?? []).join(" ")).join("\t"),
          );
        }
        break;
      default:
        break;
    }
  }
  return out;
}

export function toText(content: JSONContent): string {
  return `${textBlocks(content.content ?? [])
    .join("\n\n")
    .trim()}\n`;
}

// --- Markdown ------------------------------------------------------------------

function mdInline(node: JSONContent): string {
  return runsOf(node)
    .map((r) => {
      if (r.lineBreak) return "  \n";
      let text = r.code ? `\`${r.text}\`` : r.text.replace(/([*_`[\]\\])/g, "\\$1");
      if (r.bold) text = `**${text}**`;
      if (r.italic) text = `*${text}*`;
      if (r.strike) text = `~~${text}~~`;
      if (r.link) text = `[${text}](${r.link})`;
      return text;
    })
    .join("");
}

function mdBlocks(nodes: JSONContent[], prefix = ""): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "paragraph":
        out.push(prefix + mdInline(node));
        break;
      case "heading":
        out.push(`${prefix}${"#".repeat(Number(node.attrs?.["level"] ?? 1))} ${mdInline(node)}`);
        break;
      case "bulletList":
      case "orderedList":
      case "taskList":
        (node.content ?? []).forEach((item, index) => {
          const marker =
            node.type === "taskList"
              ? `- [${item.attrs?.["checked"] === true ? "x" : " "}] `
              : markerOf(node, item, index, "- ");
          const [first, ...rest] = mdBlocks(item.content ?? [], `${prefix}   `);
          out.push(`${prefix}${marker}${(first ?? "").trimStart()}`, ...rest);
        });
        break;
      case "blockquote":
        out.push(...mdBlocks(node.content ?? [], `${prefix}> `));
        break;
      case "codeBlock":
        out.push(`${prefix}\`\`\`\n${plain(node)}\n\`\`\``);
        break;
      case "horizontalRule":
        out.push(`${prefix}---`);
        break;
      case "table": {
        const rows = (node.content ?? []).map((row) =>
          (row.content ?? []).map((cell) =>
            mdBlocks(cell.content ?? [])
              .join(" ")
              .replace(/\|/g, "\\|"),
          ),
        );
        if (rows.length > 0) {
          const width = Math.max(...rows.map((r) => r.length));
          const line = (cells: string[]) =>
            `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
          out.push(
            [
              line(rows[0] ?? []),
              line(Array.from({ length: width }, () => "---")),
              ...rows.slice(1).map(line),
            ].join("\n"),
          );
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export function toMarkdown(content: JSONContent, title: string): string {
  return `# ${title}\n\n${mdBlocks(content.content ?? [])
    .join("\n\n")
    .trim()}\n`;
}

// --- HTML ----------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

/** @font-face rules that carry our fonts inside the page, for the files in `fonts`. */
export function fontFaces(fonts: FontBytes): string {
  const rules: string[] = [];
  for (const [family, files] of Object.entries(FONT_FILES)) {
    for (const [style, path] of Object.entries(files)) {
      const bytes = fonts.get(path);
      if (!bytes) continue;
      const weight = style.startsWith("bold") ? 700 : 400;
      const italic = style.endsWith("italics") ? "italic" : "normal";
      rules.push(
        `@font-face{font-family:"${family}";src:url(data:font/otf;base64,${base64(bytes)}) format("opentype");font-weight:${weight};font-style:${italic}}`,
      );
    }
  }
  return rules.join("\n");
}

/** A standalone page: the document and a plain print-friendly style. */
export function toHtml(content: JSONContent, title: string, lang = "es", faces = ""): string {
  const body = generateHTML(content, documentExtensions());
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${faces}
body{font-family:Satoshi,Arial,sans-serif;font-size:11pt;max-width:46rem;margin:3rem auto;padding:0 1.5rem;line-height:1.6;color:#111}
h1,h2,h3{line-height:1.25}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:.4rem .6rem;vertical-align:top}th{background:#f2f2f2}
blockquote{border-left:3px solid #999;margin-left:0;padding-left:1rem;color:#444}
pre{background:#f5f5f5;padding:.8rem;overflow:auto}code{font-family:Consolas,monospace}
ul[data-type=taskList]{list-style:none;padding-left:.2rem}ul[data-type=taskList] li{display:flex;gap:.5rem}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>
`;
}

// --- Word (.docx) ----------------------------------------------------------------

export async function toDocx(
  content: JSONContent,
  title: string,
  options: { password?: string | undefined } = {},
): Promise<Blob> {
  const d = await import("docx");
  const ALIGN = {
    left: d.AlignmentType.LEFT,
    center: d.AlignmentType.CENTER,
    right: d.AlignmentType.RIGHT,
    justify: d.AlignmentType.JUSTIFIED,
  } as const;
  const HEADING = {
    1: d.HeadingLevel.HEADING_1,
    2: d.HeadingLevel.HEADING_2,
    3: d.HeadingLevel.HEADING_3,
  } as const;

  const children = (node: JSONContent) =>
    runsOf(node).map((r) => {
      if (r.lineBreak) return new d.TextRun({ text: "", break: 1 });
      const run = new d.TextRun({
        text: r.text,
        ...(r.bold ? { bold: true } : {}),
        ...(r.italic ? { italics: true } : {}),
        ...(r.underline || r.link ? { underline: {} } : {}),
        ...(r.strike ? { strike: true } : {}),
        ...(r.code ? { font: "Consolas" } : r.font ? { font: r.font } : {}),
        ...(r.size ? { size: Math.round(r.size * 2) } : {}),
        ...(r.link ? { color: "1F5FD6" } : r.color ? { color: r.color.slice(1) } : {}),
        ...(r.highlight
          ? { shading: { type: d.ShadingType.CLEAR, color: "auto", fill: r.highlight.slice(1) } }
          : {}),
        ...(r.script === "super" ? { superScript: true } : {}),
        ...(r.script === "sub" ? { subScript: true } : {}),
      });
      return r.link ? new d.ExternalHyperlink({ link: r.link, children: [run] }) : run;
    });

  type Block = InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>;

  const blocks = (
    nodes: JSONContent[],
    list?: { reference: string; level: number },
    quote = false,
  ): Block[] => {
    const out: Block[] = [];
    for (const node of nodes) {
      switch (node.type) {
        case "paragraph":
          out.push(
            new d.Paragraph({
              children: children(node),
              alignment: ALIGN[alignOf(node)],
              ...(list ? { numbering: list } : {}),
              ...(quote ? { indent: { left: 720 }, style: "Quote" } : {}),
            }),
          );
          break;
        case "heading": {
          const level = Math.min(3, Math.max(1, Number(node.attrs?.["level"] ?? 1))) as 1 | 2 | 3;
          out.push(
            new d.Paragraph({
              children: children(node),
              heading: HEADING[level],
              alignment: ALIGN[alignOf(node)],
            }),
          );
          break;
        }
        case "bulletList":
        case "orderedList": {
          const reference = node.type === "bulletList" ? "bullets" : "numbers";
          const level = list ? list.level + 1 : 0;
          for (const item of node.content ?? []) {
            out.push(...blocks(item.content ?? [], { reference, level }, quote));
          }
          break;
        }
        case "taskList": {
          // Word lists have no tick boxes: each item starts with one, as text.
          const left = 720 * ((list?.level ?? -1) + 2);
          for (const item of node.content ?? []) {
            const [first, ...rest] = item.content ?? [];
            out.push(
              new d.Paragraph({
                children: [
                  new d.TextRun({ text: markerOf(node, item, 0, "") }),
                  ...children(first ?? {}),
                ],
                indent: { left, hanging: 360 },
              }),
              ...blocks(rest, list, quote),
            );
          }
          break;
        }
        case "blockquote":
          out.push(...blocks(node.content ?? [], list, true));
          break;
        case "codeBlock":
          for (const line of plain(node).split("\n")) {
            out.push(
              new d.Paragraph({ children: [new d.TextRun({ text: line, font: "Consolas" })] }),
            );
          }
          break;
        case "horizontalRule":
          out.push(
            new d.Paragraph({
              children: [],
              border: {
                bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "999999", space: 1 },
              },
            }),
          );
          break;
        case "table":
          out.push(
            new d.Table({
              width: { size: 100, type: d.WidthType.PERCENTAGE },
              rows: (node.content ?? []).map(
                (row) =>
                  new d.TableRow({
                    children: (row.content ?? []).map(
                      (cell) =>
                        new d.TableCell({
                          children: (() => {
                            const inner = blocks(cell.content ?? []).filter(
                              (b): b is InstanceType<typeof d.Paragraph> =>
                                b instanceof d.Paragraph,
                            );
                            return inner.length > 0 ? inner : [new d.Paragraph("")];
                          })(),
                          ...(cell.type === "tableHeader" ? { shading: { fill: "F2F2F2" } } : {}),
                        }),
                    ),
                  }),
              ),
            }),
          );
          break;
        default:
          break;
      }
    }
    return out;
  };

  const levels = (format: "bullet" | "decimal") =>
    Array.from({ length: 6 }, (_, level) => ({
      level,
      format: format === "bullet" ? d.LevelFormat.BULLET : d.LevelFormat.DECIMAL,
      text: format === "bullet" ? (["•", "◦", "▪"][level % 3] ?? "•") : `%${level + 1}.`,
      alignment: d.AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    }));

  const file = new d.Document({
    title,
    creator: "The Somnus",
    // Our font, by name: Word shows it where it is installed and its nearest
    // match elsewhere.
    styles: {
      default: {
        document: { run: { font: DEFAULT_FONT, size: DEFAULT_FONT_SIZE * 2 } },
      },
    },
    numbering: {
      config: [
        { reference: "bullets", levels: levels("bullet") },
        { reference: "numbers", levels: levels("decimal") },
      ],
    },
    sections: [
      {
        children: [
          new d.Paragraph({ text: title, heading: d.HeadingLevel.TITLE }),
          ...blocks(content.content ?? []),
        ],
      },
    ],
  });
  const blob = await d.Packer.toBlob(file);
  if (!options.password) return blob;
  const { encryptOfficeFile } = await import("./office-crypto.js");
  const locked = await encryptOfficeFile(
    new Uint8Array(await blob.arrayBuffer()),
    options.password,
  );
  return new Blob([locked], { type: EXPORT_MIME.docx });
}

// --- PDF ---------------------------------------------------------------------------

export async function toPdf(
  content: JSONContent,
  title: string,
  options: { password?: string | undefined; fonts?: FontBytes } = {},
): Promise<Blob> {
  const [pdfMake, vfs] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  const maker = (pdfMake as unknown as { default?: typeof pdfMake }).default ?? pdfMake;
  maker.addVirtualFileSystem(
    ((vfs as unknown as { default?: unknown }).default ?? vfs) as Parameters<
      typeof maker.addVirtualFileSystem
    >[0],
  );
  // The document is the only input: never let the PDF writer fetch anything.
  maker.setUrlAccessPolicy(() => false);

  // Our fonts, from bytes already read. Any other font, or ours when its files
  // could not be read, is written in the PDF writer's own (Roboto).
  const fonts = options.fonts ?? new Map<string, Uint8Array>();
  const embedded = new Set<string>(["Roboto"]);
  const families: Record<string, Record<string, string>> = {};
  const files: Record<string, string> = {};
  for (const [family, paths] of Object.entries(FONT_FILES)) {
    if (!hasFont(fonts, family as BrandFont)) continue;
    const styles: Record<string, string> = {};
    for (const [style, path] of Object.entries(paths)) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      files[name] = base64(fonts.get(path) ?? new Uint8Array());
      styles[style] = name;
    }
    families[family] = styles;
    embedded.add(family);
  }
  maker.addVirtualFileSystem(files as Parameters<typeof maker.addVirtualFileSystem>[0]);
  maker.addFonts(families as Parameters<typeof maker.addFonts>[0]);
  const fontFor = (name: string) => (embedded.has(name) ? name : "Roboto");

  type Content = import("pdfmake/interfaces").Content;

  const inline = (node: JSONContent) =>
    runsOf(node).map((r) =>
      r.lineBreak
        ? { text: "\n" }
        : {
            text: r.text,
            ...(r.bold ? { bold: true } : {}),
            ...(r.italic ? { italics: true } : {}),
            ...(r.underline || r.link ? { decoration: "underline" as const } : {}),
            ...(r.strike ? { decoration: "lineThrough" as const } : {}),
            ...(r.link ? { link: r.link, color: "#1f5fd6" } : r.color ? { color: r.color } : {}),
            ...(r.code
              ? { background: "#f2f2f2" }
              : r.highlight
                ? { background: r.highlight }
                : {}),
            ...(r.font ? { font: fontFor(r.font) } : {}),
            ...(r.size ? { fontSize: r.size } : {}),
            ...(r.script === "super" ? { sup: true } : {}),
            ...(r.script === "sub" ? { sub: true } : {}),
          },
    );

  const blocks = (nodes: JSONContent[]): Content[] => {
    const out: Content[] = [];
    for (const node of nodes) {
      switch (node.type) {
        case "paragraph":
          out.push({ text: inline(node), alignment: alignOf(node), margin: [0, 0, 0, 6] });
          break;
        case "heading": {
          const level = Number(node.attrs?.["level"] ?? 1);
          out.push({
            text: inline(node),
            alignment: alignOf(node),
            bold: true,
            fontSize: level === 1 ? 18 : level === 2 ? 15 : 13,
            margin: [0, 10, 0, 6],
          });
          break;
        }
        case "bulletList":
          out.push({ ul: (node.content ?? []).map((item) => blocks(item.content ?? [])) });
          break;
        case "orderedList":
          out.push({ ol: (node.content ?? []).map((item) => blocks(item.content ?? [])) });
          break;
        case "taskList":
          for (const item of node.content ?? []) {
            const [first, ...rest] = item.content ?? [];
            // The boxes are drawn in Roboto, which has them.
            out.push({
              text: [{ text: markerOf(node, item, 0, ""), font: "Roboto" }, ...inline(first ?? {})],
              margin: [0, 0, 0, 4],
            });
            out.push(...blocks(rest));
          }
          break;
        case "blockquote":
          out.push({ stack: blocks(node.content ?? []), margin: [18, 0, 0, 6], color: "#444" });
          break;
        case "codeBlock":
          out.push({ text: plain(node), fontSize: 9, background: "#f2f2f2", margin: [0, 0, 0, 6] });
          break;
        case "horizontalRule":
          out.push({
            canvas: [{ type: "line", x1: 0, y1: 4, x2: 515, y2: 4, lineWidth: 0.5 }],
            margin: [0, 4, 0, 8],
          });
          break;
        case "table": {
          const body = (node.content ?? []).map((row) =>
            (row.content ?? []).map((cell) => ({
              stack: blocks(cell.content ?? []),
              ...(cell.type === "tableHeader" ? { fillColor: "#f2f2f2", bold: true } : {}),
            })),
          );
          const width = Math.max(0, ...body.map((r) => r.length));
          const filled = body.map((r) => [
            ...r,
            ...Array.from({ length: width - r.length }, () => ({ text: "" })),
          ]);
          if (width > 0) {
            out.push({
              table: { widths: Array.from({ length: width }, () => "*"), body: filled },
              margin: [0, 0, 0, 8],
            });
          }
          break;
        }
        default:
          break;
      }
    }
    return out;
  };

  return maker
    .createPdf({
      info: { title, creator: "The Somnus" },
      ...(options.password
        ? {
            // PDF 1.7 extension level 3 is AES-256, the strongest PDF readers know.
            version: "1.7ext3" as const,
            userPassword: options.password,
            ownerPassword: options.password,
            permissions: {
              printing: "highResolution" as const,
              modifying: true,
              copying: true,
              annotating: true,
              fillingForms: true,
              contentAccessibility: true,
              documentAssembly: true,
            },
          }
        : {}),
      pageMargins: [56, 56, 56, 56],
      defaultStyle: { font: fontFor(DEFAULT_FONT), fontSize: DEFAULT_FONT_SIZE, lineHeight: 1.3 },
      content: [
        { text: title, fontSize: 22, bold: true, margin: [0, 0, 0, 14] },
        ...blocks(content.content ?? []),
      ],
    })
    .getBlob();
}

/** The chosen format, as a Blob ready to save; Word and PDF take a password. */
export async function exportDocument(
  format: ExportFormat,
  content: JSONContent,
  title: string,
  lang: string,
  options: { password?: string | undefined } = {},
): Promise<Blob> {
  switch (format) {
    case "docx":
      return toDocx(content, title, options);
    case "pdf":
      return toPdf(content, title, { ...options, fonts: await loadFonts(fontsUsed(content)) });
    case "html":
      return new Blob(
        [toHtml(content, title, lang, fontFaces(await loadFonts(fontsUsed(content))))],
        { type: EXPORT_MIME.html },
      );
    case "md":
      return new Blob([toMarkdown(content, title)], { type: EXPORT_MIME.md });
    case "txt":
      return new Blob([toText(content)], { type: EXPORT_MIME.txt });
  }
}
