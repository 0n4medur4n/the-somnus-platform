/** True for an HTML file, by its type or, failing that, its name. */
export function isHtml(mime: string | undefined, name: string | undefined): boolean {
  return mime === "text/html" || /\.html?$/i.test(name ?? "");
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Scripts and styles may run, because a page often is its scripts. Nothing may
 * come in or go out: no connection, no remote image or font, no form, no
 * navigating the frame away. A frame in `srcdoc` inherits this policy from the
 * page that holds it, so the file needs no editing to be under it, and it is in
 * force before the file's first byte is read.
 */
const POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * A page that shows an HTML file from the Drive, the same in the viewer and in
 * a tab of its own. An HTML file is a program, and the console's origin holds
 * the sign-in, so it must never run there: it runs in a `sandbox="allow-scripts"`
 * frame, an opaque origin that reaches no cookie, no storage and no other page.
 * This holder has no script of its own, and the file reaches it only as an
 * escaped attribute: in a tab it does carry the console's origin.
 *
 * `clipboard-write` lets a page's own "copy" button work. It adds nothing a page
 * could not do already through `execCommand`, and it never lets one read.
 */
export function htmlViewerPage(name: string, source: string): string {
  const title = escapeAttribute(name);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${POLICY}">
<title>${title}</title>
<style>html,body{height:100%;margin:0;background:#fff}iframe{display:block;width:100%;height:100%;border:0}</style>
</head><body><iframe title="${title}" sandbox="allow-scripts" allow="clipboard-write" srcdoc="${escapeAttribute(source)}"></iframe></body></html>`;
}
