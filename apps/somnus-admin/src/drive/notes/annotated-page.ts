/**
 * The console speaking to a page being annotated, and the page speaking back.
 * Blocks are the page's readable pieces, in order: headings, paragraphs, list
 * items, table rows and code.
 */
export type ToPage =
  | {
      t: "marks";
      marks: Array<{ index: number; count: number; done: boolean }>;
      canAdd: boolean;
      addLabel: string;
    }
  | { t: "go"; index: number }
  /** Reading aloud: the block being read (null: none) and the word, as offsets in its full text. */
  | { t: "read"; index: number | null; start?: number; end?: number };

export type FromPage =
  /** `full` is each block's whole text as a reader hears it; `blocks` is cut for note quotes. */
  | { t: "blocks"; blocks: unknown; full?: unknown }
  | { t: "add"; index: unknown }
  | { t: "focus"; index: unknown };

/**
 * The one script the page may run, named by its hash: it finds the blocks, shows
 * "add a note" beside the one under the mouse and marks the ones with notes. It
 * sees the page's own text and nothing else, and it writes only classes, a count
 * and its own button's label.
 */
const SCRIPT = `(function () {
  var blocks = [], maps = [], canAdd = false, hovered = -1, add, reading = null;
  function tell(m) { parent.postMessage(m, "*"); }
  function words(e) { return (e.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200); }
  // A block's whole text as a reader hears it (spaces collapsed, a space
  // between table cells), and where each character is, to mark a word.
  function spoken(e) {
    var text = "", map = [], pending = null, cell = null;
    var walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (var n = walk.nextNode(); n; n = walk.nextNode()) {
      var here = n.parentElement && n.parentElement.closest("td,th");
      if (here !== cell) { if (text && !pending) pending = [n, 0]; cell = here; }
      var s = n.data;
      for (var i = 0; i < s.length; i++) {
        if (/\\s/.test(s[i])) { if (text && !pending) pending = [n, i]; continue; }
        if (pending) { text += " "; map.push(pending); pending = null; }
        text += s[i];
        map.push([n, i]);
      }
    }
    return { text: text, map: map };
  }
  function start() {
    var found = document.body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,tr,pre");
    var texts = [], full = [];
    for (var i = 0; i < found.length; i++) {
      var e = found[i], own = e.tagName === "LI" || e.tagName === "TR";
      if (!own && e.parentElement.closest("li,td,th")) continue;
      var text = words(e);
      if (!text) continue;
      e.setAttribute("data-somnus-block", String(blocks.length));
      blocks.push(e);
      texts.push(text);
      var heard = spoken(e);
      maps.push(heard.map);
      full.push(heard.text);
    }
    add = document.createElement("button");
    add.type = "button";
    add.id = "somnus-add";
    document.body.appendChild(add);
    add.addEventListener("click", function () { if (hovered >= 0) tell({ t: "add", index: hovered }); });
    document.addEventListener("mouseover", function (ev) {
      if (ev.target === add || !canAdd) return;
      var b = ev.target.closest && ev.target.closest("[data-somnus-block]");
      if (!b) { add.style.display = "none"; hovered = -1; return; }
      hovered = Number(b.getAttribute("data-somnus-block"));
      add.style.display = "block";
      var r = b.getBoundingClientRect();
      var room = b.classList.contains("somnus-noted") ? 36 : 6;
      var left = Math.min(r.right - add.offsetWidth - room, innerWidth - add.offsetWidth - 8);
      add.style.top = scrollY + r.top + 2 + "px";
      add.style.left = scrollX + Math.max(left, 8) + "px";
    });
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (t === add || !t.closest || t.closest("a,input") || String(getSelection())) return;
      var b = t.closest(".somnus-noted");
      if (b) tell({ t: "focus", index: Number(b.getAttribute("data-somnus-block")) });
    });
    tell({ t: "blocks", blocks: texts, full: full });
  }
  addEventListener("message", function (ev) {
    var m = ev.data;
    if (ev.source !== parent || !m || !add) return;
    if (m.t === "marks") {
      canAdd = m.canAdd === true;
      add.textContent = String(m.addLabel);
      if (!canAdd) add.style.display = "none";
      blocks.forEach(function (b) {
        b.classList.remove("somnus-noted", "somnus-done");
        b.removeAttribute("data-somnus-count");
      });
      m.marks.forEach(function (x) {
        var b = blocks[x.index];
        if (!b) return;
        b.classList.add("somnus-noted");
        if (x.done) b.classList.add("somnus-done");
        b.setAttribute("data-somnus-count", String(x.count));
      });
    } else if (m.t === "read") {
      var b = typeof m.index === "number" ? blocks[m.index] : null;
      if (b !== reading) {
        if (reading) reading.classList.remove("somnus-reading");
        if (b) { b.classList.add("somnus-reading"); b.scrollIntoView({ block: "center", behavior: "smooth" }); }
        reading = b;
      }
      if (!window.CSS || !CSS.highlights) return;
      var map = b ? maps[m.index] : null;
      var first = map && map[m.start], last = map && map[m.end - 1];
      if (!first || !last) { CSS.highlights.delete("somnus-word"); return; }
      var range = document.createRange();
      range.setStart(first[0], first[1]);
      range.setEnd(last[0], last[1] + 1);
      CSS.highlights.set("somnus-word", new Highlight(range));
      var r = range.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) scrollBy({ top: r.top - innerHeight / 2, behavior: "smooth" });
    } else if (m.t === "go" && blocks[m.index]) {
      var b = blocks[m.index];
      b.scrollIntoView({ block: "center", behavior: "smooth" });
      b.classList.add("somnus-flash");
      setTimeout(function () { b.classList.remove("somnus-flash"); }, 1600);
    }
  });
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start);
  else start();
})();`;

const STYLE = `<style>
.somnus-noted{position:relative;background:#fff3bf;box-shadow:inset 4px 0 #e0a800;padding-left:.6rem;padding-right:2.4rem;cursor:pointer;border-radius:4px}
.somnus-noted::after{content:attr(data-somnus-count);position:absolute;right:.4rem;top:.25rem;min-width:1.4rem;height:1.4rem;padding:0 .2rem;box-sizing:border-box;border-radius:999px;background:#e0a800;color:#1f2328;font:700 .75rem/1.4rem Arial,sans-serif;text-align:center}
tr.somnus-noted td{background:#fff3bf}
.somnus-done{background:#eef1f4;box-shadow:inset 4px 0 #afb8c1}
tr.somnus-done td{background:#eef1f4}
.somnus-done::after{background:#afb8c1}
.somnus-flash{outline:2px solid #2563eb;outline-offset:2px}
.somnus-reading{background:#dbe7ff;box-shadow:inset 4px 0 #437ef7;border-radius:4px}
tr.somnus-reading td{background:#dbe7ff}
::highlight(somnus-word){background-color:#437ef7;color:#fff}
#somnus-add{display:none;position:absolute;z-index:10;margin:0;padding:.2rem .6rem;border:0;border-radius:999px;background:#2563eb;color:#fff;font:600 .75rem Arial,sans-serif;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.3)}
</style>`;

const PLAIN_POLICY = "default-src 'none'; style-src 'unsafe-inline'";

/**
 * A preview page, ready for notes. The file's own content can still run nothing:
 * the policy names this script by hash, so no `<script>`, handler or `javascript:`
 * link in the document qualifies, and the frame stays an opaque origin with no
 * connection. The script is in the head so nothing in the file can swallow it.
 */
export async function annotatedPage(page: string): Promise<string> {
  if (!page.includes(PLAIN_POLICY)) throw new Error("Preview page has no policy to extend");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SCRIPT));
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const policy = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'`;
  const opened = page.replace(`content="${PLAIN_POLICY}">`, () => {
    return `content="${policy}">${STYLE}<script>${SCRIPT}</script>`;
  });
  return opened;
}
