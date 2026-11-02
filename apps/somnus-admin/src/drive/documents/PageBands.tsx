import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "../../components/ui/Icon.js";
import { Menu } from "../../components/ui/ui.js";
import { documentExtensions } from "./doc-format.js";
import { LOGOS, logoImage } from "./doc-image.js";

const EMPTY: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

/** Ready-made headers: our logo with the title beside it, or centred alone. */
function presets(title: string): Record<string, (logo: JSONContent) => JSONContent> {
  return {
    logoTitle: (logo) => ({
      type: "doc",
      content: [
        { ...logo, attrs: { ...logo.attrs, width: 30, align: "left" } },
        {
          type: "paragraph",
          attrs: { textAlign: "right" },
          content: title ? [{ type: "text", text: title, marks: [{ type: "bold" }] }] : [],
        },
      ],
    }),
    logoCentred: (logo) => ({
      type: "doc",
      content: [{ ...logo, attrs: { ...logo.attrs, width: 35, align: "center" } }],
    }),
  };
}

function BandButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`rounded p-1 ${active ? "bg-somnus-primary/20 text-somnus-primary" : "text-[#5f6368] hover:bg-black/5"}`}
    >
      <Icon name={icon} className="h-4 w-4" />
    </button>
  );
}

/**
 * The header or the footer of every page: written like the document, in a
 * band at the top or bottom of the sheet, with a small toolbar of its own when
 * it is being edited. It is saved with the document and printed on every page
 * of a Word or PDF export.
 */
export function PageBand({
  kind,
  initial,
  title,
  readOnly,
  onChange,
}: {
  kind: "header" | "footer";
  initial: JSONContent | undefined;
  title: string;
  readOnly: boolean;
  onChange: (content: JSONContent | undefined) => void;
}) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const latest = useRef(onChange);
  latest.current = onChange;
  const editor = useEditor({
    extensions: documentExtensions(),
    content: initial ?? EMPTY,
    editable: !readOnly,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: "somnus-band",
        "aria-label": t(`drive.doc.bands.${kind}`),
      },
    },
    onUpdate: ({ editor: e }) => latest.current(e.isEmpty ? undefined : e.getJSON()),
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      empty: e?.isEmpty ?? true,
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      align: (["center", "right"] as const).find((a) => e?.isActive({ textAlign: a })) ?? "left",
    }),
  });

  useEffect(() => {
    // Without an update: opening a document must not mark it as changed.
    editor?.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  // A menu item disappears when it is chosen, and takes focus with it without
  // a blur: so the band also closes its toolbar when focus or a click lands
  // anywhere else.
  const band = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (!focused) return;
    const away = (event: Event) => {
      if (!band.current?.contains(event.target as Node)) setFocused(false);
    };
    document.addEventListener("focusin", away);
    document.addEventListener("mousedown", away);
    return () => {
      document.removeEventListener("focusin", away);
      document.removeEventListener("mousedown", away);
    };
  }, [focused]);

  if (!editor || (readOnly && state?.empty)) return null;

  async function withLogo(apply: (logo: JSONContent) => void, path: string, alt: string) {
    const picture = await logoImage(path);
    if (!picture || !editor) return;
    apply({
      type: "image",
      attrs: {
        src: picture.src,
        alt,
        width: 30,
        align: "left",
        naturalWidth: picture.width,
        naturalHeight: picture.height,
      },
    });
  }

  const chain = () => editor.chain().focus();
  const shapes = presets(title);
  return (
    // Focus anywhere in the band (its text, its toolbar, its menu) keeps the
    // toolbar showing; it hides only when focus leaves the band.
    <fieldset
      ref={band}
      aria-label={t(`drive.doc.bands.${kind}`)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      className={`group relative m-0 min-w-0 p-0 ${kind === "header" ? "mb-6 border-b" : "mt-10 border-t"} border-dashed ${
        focused ? "border-[#437ef7]" : "border-[#dadce0]"
      }`}
    >
      {readOnly ? null : (
        <div
          className={`absolute -top-9 right-0 z-10 flex items-center gap-0.5 rounded-lg border border-black/10 bg-white px-1 py-0.5 shadow ${
            focused
              ? ""
              : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
          }`}
        >
          <span className="px-1 text-[11px] font-medium text-[#5f6368]">
            {t(`drive.doc.bands.${kind}`)}
          </span>
          <BandButton
            icon="bold"
            label={t("drive.doc.tools.bold")}
            active={state?.bold}
            onClick={() => chain().toggleBold().run()}
          />
          <BandButton
            icon="italic"
            label={t("drive.doc.tools.italic")}
            active={state?.italic}
            onClick={() => chain().toggleItalic().run()}
          />
          {(["left", "center", "right"] as const).map((a) => (
            <BandButton
              key={a}
              icon={a === "left" ? "alignLeft" : a === "center" ? "alignCenter" : "alignRight"}
              label={t(`drive.doc.tools.align${a[0]?.toUpperCase()}${a.slice(1)}`)}
              active={state?.align === a}
              onClick={() => chain().setTextAlign(a).run()}
            />
          ))}
          <Menu
            label={t("drive.doc.bands.insert")}
            items={[
              ...LOGOS.map((logo) => ({
                label: t(`drive.doc.image.logos.${logo.key}`),
                icon: "star" as const,
                onSelect: () =>
                  void withLogo(
                    (node) => chain().insertContent(node).run(),
                    logo.path,
                    t(`drive.doc.image.logos.${logo.key}`),
                  ),
              })),
              ...(kind === "header"
                ? (["logoTitle", "logoCentred"] as const).map((key) => ({
                    label: t(`drive.doc.bands.presets.${key}`),
                    icon: "grid" as const,
                    onSelect: () =>
                      void withLogo(
                        (node) =>
                          chain()
                            .setContent(shapes[key]?.(node) ?? EMPTY, { emitUpdate: true })
                            .run(),
                        LOGOS[0].path,
                        t(`drive.doc.image.logos.${LOGOS[0].key}`),
                      ),
                  }))
                : []),
              {
                label: t("drive.doc.bands.clear"),
                icon: "trash" as const,
                onSelect: () => chain().setContent(EMPTY, { emitUpdate: true }).run(),
              },
            ]}
            trigger={({ onClick, expanded }) => (
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={expanded}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onClick}
                title={t("drive.doc.bands.insert")}
                aria-label={t("drive.doc.bands.insert")}
                className="rounded p-1 text-[#5f6368] hover:bg-black/5"
              >
                <Icon name="image" className="h-4 w-4" />
              </button>
            )}
          />
        </div>
      )}
      <div className="relative">
        {state?.empty && !focused && !readOnly ? (
          <p className="pointer-events-none absolute inset-x-0 top-1 text-[9pt] text-[#9aa0a6]">
            {t(`drive.doc.bands.placeholder.${kind}`)}
          </p>
        ) : null}
        <EditorContent editor={editor} />
      </div>
    </fieldset>
  );
}

/** What the footer adds by itself: the document's code, and the page numbers. */
export function FooterOptions({
  code,
  pageNumbers,
  readOnly,
  onPageNumbers,
}: {
  code: string | undefined;
  pageNumbers: boolean;
  readOnly: boolean;
  onPageNumbers: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[8pt] text-[#80868b]">
      <span className="font-mono">{code ? `${t("drive.doc.code.label")} ${code}` : null}</span>
      <span className="flex items-center gap-3">
        {pageNumbers ? <span>{t("drive.doc.bands.pageSample")}</span> : null}
        {readOnly ? null : (
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={pageNumbers}
              onChange={(event) => onPageNumbers(event.target.checked)}
              className="h-3 w-3 accent-[#437ef7]"
            />
            {t("drive.doc.bands.numberPages")}
          </label>
        )}
      </span>
    </div>
  );
}
