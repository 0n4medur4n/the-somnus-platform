import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DriveItem, DriveSession } from "../drive-session.js";
import { useDriveTask } from "../ui/drive-ui.js";
import type { DriveNote, NoteAnchor } from "./notes-format.js";

export type NotesBinding = {
  list: DriveNote[];
  canEdit: boolean;
  busy: boolean;
  error: string | null;
  authorOf: (userId: string) => string;
  add: (text: string, anchor: NoteAnchor) => Promise<boolean>;
  setDone: (id: string, done: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

/** The notes on one open item, decrypted and kept here only while it is open. */
export function useNotes(
  session: DriveSession,
  shareId: string | null,
  item: DriveItem | null,
  canEdit: boolean,
): NotesBinding | undefined {
  const { t } = useTranslation();
  const { run, busy, error } = useDriveTask();
  const [list, setList] = useState<DriveNote[]>([]);
  const itemId = item?.node.id ?? null;

  useEffect(() => {
    setList([]);
    if (!itemId || !shareId) return;
    let cancelled = false;
    void run(() => session.readNotes(shareId, itemId)).then((notes) => {
      if (!cancelled && notes) setList(notes);
    });
    return () => {
      cancelled = true;
    };
  }, [itemId, run, session, shareId]);

  const change = useCallback(
    async (mutate: (notes: DriveNote[]) => DriveNote[]): Promise<boolean> => {
      if (!shareId || !itemId) return false;
      const saved = await run(() => session.changeNotes(shareId, itemId, mutate));
      if (saved) setList(saved);
      return saved !== null;
    },
    [itemId, run, session, shareId],
  );

  return useMemo(() => {
    if (!itemId) return undefined;
    return {
      list,
      canEdit,
      busy,
      error,
      authorOf: (userId: string) =>
        userId === session.me.userId
          ? t("drive.members.you")
          : (session.person(userId).email ?? t("drive.folder.unknownAuthor")),
      add: (text: string, anchor: NoteAnchor) =>
        change((notes) => [
          ...notes,
          {
            id: crypto.randomUUID(),
            authorId: session.me.userId,
            text,
            createdAt: new Date().toISOString(),
            done: false,
            anchor,
          },
        ]),
      setDone: async (id: string, done: boolean) => {
        await change((notes) => notes.map((n) => (n.id === id ? { ...n, done } : n)));
      },
      remove: async (id: string) => {
        await change((notes) => notes.filter((n) => n.id !== id));
      },
    };
  }, [busy, canEdit, change, error, itemId, list, session, t]);
}
