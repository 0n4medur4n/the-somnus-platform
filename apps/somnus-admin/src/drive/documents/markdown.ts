/** True for a Markdown file, by its type or, failing that, its name: browsers often send no type. */
export function isMarkdown(mime: string | undefined, name: string | undefined): boolean {
  return mime === "text/markdown" || /\.(md|markdown)$/i.test(name ?? "");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Markdown as HTML, converted in this browser from the bytes already decrypted
 * here. GitHub's dialect: bold, tables, task lists, strikethrough, code.
 *
 * The file is not trusted, so the renderer keeps only what it wrote itself. Raw
 * HTML in the source is shown as text (bar a line break, which tables need);
 * an image becomes its description, because fetching one would tell an outside
 * server the file was opened; a link stays a link only for http, https and mail.
 */
export async function markdownToHtml(text: string): Promise<string> {
  const { Marked } = await import("marked");
  const marked = new Marked({
    gfm: true,
    async: false,
    renderer: {
      html({ text: raw }) {
        const value = raw.trim();
        if (value.startsWith("<!--")) return "";
        return /^<br\s*\/?>$/i.test(value) ? "<br>" : escapeHtml(raw);
      },
      image({ text: description }) {
        return escapeHtml(description);
      },
      link({ href, tokens }) {
        const label = this.parser.parseInline(tokens);
        if (!/^(https?:|mailto:)/i.test(href)) return label;
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      },
    },
  });
  return marked.parse(text) as string;
}

/** A page for the sandboxed preview frame: the rendered Markdown, set like a document. */
export function markdownPage(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
body{font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;color:#1f2328;background:#fff;max-width:50rem;margin:0 auto;padding:2.5rem 2rem 4rem;overflow-wrap:break-word}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.6em 0 .6em;font-weight:600}
h1{font-size:2em;border-bottom:1px solid #d1d9e0;padding-bottom:.3em}
h2{font-size:1.5em;border-bottom:1px solid #d1d9e0;padding-bottom:.3em}
h3{font-size:1.25em}h4{font-size:1em}h5{font-size:.875em}h6{font-size:.85em;color:#59636e}
body>:first-child{margin-top:0}
p,ul,ol,blockquote,pre,table{margin:0 0 1em}
ul,ol{padding-left:2em}li+li{margin-top:.25em}
li:has(>input[type=checkbox]){list-style:none;margin-left:-1.4em}
strong{font-weight:700}
a{color:#0969da}
hr{height:1px;border:0;background:#d1d9e0;margin:1.5em 0}
blockquote{padding:0 1em;color:#59636e;border-left:.25em solid #d1d9e0}
code{font-family:Consolas,Menlo,monospace;font-size:.875em;background:#eff1f3;padding:.2em .4em;border-radius:6px}
pre{background:#f6f8fa;padding:1em;border-radius:6px;overflow:auto;line-height:1.45}
pre code{background:none;padding:0;font-size:.85em}
table{display:block;width:max-content;max-width:100%;overflow:auto;border-collapse:collapse;font-size:.95em}
th,td{border:1px solid #d1d9e0;padding:.45em .8em;vertical-align:top}
th{background:#f6f8fa;font-weight:600}
tr:nth-child(even) td{background:#f9fafb}
</style></head><body>${html}</body></html>`;
}
