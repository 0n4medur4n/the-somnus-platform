import { useEffect, useRef, useState } from "react";
import { annotatedPage, type FromPage, type ToPage } from "./annotated-page.js";
import type { BlockMark } from "./notes-format.js";

/**
 * A preview that takes notes: the marks go in, and "add a note here" comes out.
 * Messages are accepted only from this frame and only as a block's number, which
 * is checked against the blocks it reported. A block's text is used only as the
 * note's quote.
 */
export function AnnotatedFrame({
  title,
  page,
  sandbox,
  className,
  marks,
  canAdd,
  addLabel,
  goTo,
  reading,
  phrases,
  onBlocks,
  onFullBlocks,
  onSelect,
  onAdd,
  onFocus,
  onFailed,
}: {
  title: string;
  page: string;
  /** What this kind of page may do, beyond running the note script. */
  sandbox: string;
  className: string;
  marks: BlockMark[];
  canAdd: boolean;
  addLabel: string;
  /** Scrolls to a block; a new `nonce` repeats the same block. */
  goTo: { index: number; nonce: number } | null;
  /** The block being read aloud, and the word, as offsets in its full text. */
  reading?: { index: number | null; start?: number; end?: number } | undefined;
  /** Marked phrases, and the labels of the bar that marks a selection. */
  phrases?:
    | {
        marks: Array<{ index: number; start: number; end: number; color: string }>;
        labels: { comment: string; colors: Record<string, string> };
      }
    | undefined;
  onBlocks: (blocks: string[]) => void;
  /** Each block's whole text, for reading aloud and marking phrases. */
  onFullBlocks?: ((texts: string[]) => void) | undefined;
  /** A selection to mark or comment on; checked against the text by the caller. */
  onSelect?:
    | ((choice: {
        index: number;
        start: number;
        end: number;
        color: string;
        comment: boolean;
      }) => void)
    | undefined;
  onAdd: (index: number) => void;
  onFocus: (index: number) => void;
  onFailed: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState<string | null>(null);
  const [blockCount, setBlockCount] = useState<number | null>(null);
  const latest = useRef({ onBlocks, onFullBlocks, onSelect, onAdd, onFocus, onFailed });
  latest.current = { onBlocks, onFullBlocks, onSelect, onAdd, onFocus, onFailed };

  useEffect(() => {
    let cancelled = false;
    annotatedPage(page).then(
      (html) => {
        if (!cancelled) setReady(html);
      },
      () => latest.current.onFailed(),
    );
    return () => {
      cancelled = true;
    };
  }, [page]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<FromPage>) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = event.data;
      if (message?.t === "blocks" && Array.isArray(message.blocks)) {
        const blocks = message.blocks.filter((b): b is string => typeof b === "string");
        setBlockCount(blocks.length);
        latest.current.onBlocks(blocks);
        // The same blocks, whole; anything else is dropped rather than misaligned.
        const full = Array.isArray(message.full) ? message.full : [];
        if (full.length === blocks.length && full.every((b) => typeof b === "string")) {
          latest.current.onFullBlocks?.(full as string[]);
        }
        return;
      }
      if (message?.t === "select") {
        const { index, start, end, color, comment } = message;
        const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
        if (!whole(index) || !whole(start) || !whole(end) || typeof color !== "string") return;
        if (blockCount === null || index < 0 || index >= blockCount || start < 0 || end <= start) {
          return;
        }
        latest.current.onSelect?.({ index, start, end, color, comment: comment === true });
        return;
      }
      if (message?.t !== "add" && message?.t !== "focus") return;
      const { index } = message;
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return;
      if (blockCount === null || index >= blockCount) return;
      if (message.t === "add") latest.current.onAdd(index);
      else latest.current.onFocus(index);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [blockCount]);

  useEffect(() => {
    if (blockCount === null) return;
    const message: ToPage = { t: "marks", marks, canAdd, addLabel };
    frame.current?.contentWindow?.postMessage(message, "*");
  }, [blockCount, marks, canAdd, addLabel]);

  useEffect(() => {
    if (blockCount === null || !goTo) return;
    const message: ToPage = { t: "go", index: goTo.index };
    frame.current?.contentWindow?.postMessage(message, "*");
  }, [blockCount, goTo]);

  useEffect(() => {
    if (blockCount === null || reading === undefined) return;
    const index =
      reading.index !== null && reading.index >= 0 && reading.index < blockCount
        ? reading.index
        : null;
    const message: ToPage = {
      t: "read",
      index,
      ...(reading.start !== undefined ? { start: reading.start } : {}),
      ...(reading.end !== undefined ? { end: reading.end } : {}),
    };
    frame.current?.contentWindow?.postMessage(message, "*");
  }, [blockCount, reading]);

  useEffect(() => {
    if (blockCount === null || !phrases) return;
    const message: ToPage = { t: "phrases", marks: phrases.marks, labels: phrases.labels };
    frame.current?.contentWindow?.postMessage(message, "*");
  }, [blockCount, phrases]);

  if (!ready) return null;
  return (
    <iframe ref={frame} title={title} sandbox={sandbox} srcDoc={ready} className={className} />
  );
}
