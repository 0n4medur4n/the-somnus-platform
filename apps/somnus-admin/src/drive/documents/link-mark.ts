import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    somnusLink: {
      setLink: (attributes: { href: string }) => ReturnType;
      unsetLink: () => ReturnType;
    };
  }
}

/** Only the web and e-mail: a link in a Drive document can never be a script. */
export function safeHref(href: unknown): string | null {
  return typeof href === "string" && /^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : null;
}

/**
 * A link mark of our own instead of TipTap's: theirs pulls in a URL scanner
 * (linkifyjs) for auto-linking, which the editor does not need -- a link is
 * added on purpose from the toolbar -- and which ships host names such as
 * "localhost" that the Hosting bundle guard rightly refuses.
 */
export const SomnusLink = Mark.create({
  name: "link",
  priority: 1000,
  inclusive: false,

  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (element) => safeHref(element.getAttribute("href")),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[href]",
        getAttrs: (element) => (safeHref(element.getAttribute("href")) ? null : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const href = safeHref(HTMLAttributes["href"]);
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        href: href ?? undefined,
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setLink:
        (attributes) =>
        ({ chain }) =>
          safeHref(attributes.href)
            ? chain()
                .setMark(this.name, { href: safeHref(attributes.href) })
                .run()
            : false,
      unsetLink:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name, { extendEmptyMarkRange: true }).run(),
    };
  },
});
