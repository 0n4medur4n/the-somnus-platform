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
  onBlocks,
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
  onBlocks: (blocks: string[]) => void;
  onAdd: (index: number) => void;
  onFocus: (index: number) => void;
  onFailed: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState<string | null>(null);
  const [blockCount, setBlockCount] = useState<number | null>(null);
  const latest = useRef({ onBlocks, onAdd, onFocus, onFailed });
  latest.current = { onBlocks, onAdd, onFocus, onFailed };

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

  if (!ready) return null;
  return (
    <iframe ref={frame} title={title} sandbox={sandbox} srcDoc={ready} className={className} />
  );
}
