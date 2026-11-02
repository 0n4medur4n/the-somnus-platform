import type { DriveProofreadResult, DriveSpeechLang } from "@somnus/api-contracts";
import { type Editor, useEditorState } from "@tiptap/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { Icon } from "../../components/ui/Icon.js";
import { Modal } from "../../components/ui/ui.js";
import { acceptSpeechNotice, speechNoticeSeen } from "./dictation.js";
import {
  activateSuggestion,
  applySuggestions,
  dismissSuggestions,
  proofreadDocument,
  setSuggestions,
  suggestionsOf,
} from "./proofreading.js";

export type Proofreader = (text: string, lang: DriveSpeechLang) => Promise<DriveProofreadResult>;
type Mode = "suggest" | "apply";

const keepSelection = (event: { preventDefault: () => void }) => event.preventDefault();

/**
 * The proofreader in the toolbar: a button, and whether corrections are
 * suggested (the default: each accepted or dismissed) or applied at once (and
 * undone with Ctrl+Z). The first time after a reload it says where the text goes.
 */
export function ProofreadControls({
  editor,
  lang,
  proofread,
}: {
  editor: Editor;
  lang: DriveSpeechLang;
  proofread: Proofreader;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("suggest");
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const state = useEditorState({ editor, selector: ({ editor: e }) => suggestionsOf(e.state) });

  async function run() {
    setMessage(null);
    setProgress([0, 1]);
    try {
      const found = await proofreadDocument(editor.state.doc, lang, proofread, (done, total) =>
        setProgress([done, total]),
      );
      if (editor.isDestroyed) return;
      if (found.length === 0) {
        setMessage(t("drive.doc.proofread.none"));
        return;
      }
      editor.view.dispatch(setSuggestions(editor.state.tr, found));
      if (mode === "apply") {
        const tr = applySuggestions(
          editor.state,
          found.map((s) => s.id),
        );
        if (tr) editor.view.dispatch(tr);
        setMessage(t("drive.doc.proofread.applied", { count: found.length }));
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      setMessage(
        t(status === 503 ? "drive.doc.proofread.unavailable" : "drive.doc.proofread.failed"),
      );
    } finally {
      setProgress(null);
    }
  }

  function start() {
    if (progress) return;
    if (speechNoticeSeen("proofread")) void run();
    else setAsking(true);
  }

  const active = state.items.find((item) => item.id === state.active) ?? null;
  const coords = active ? editor.view.coordsAtPos(active.from) : null;
  const act = (ids: string[], accept: boolean) => {
    const tr = accept
      ? applySuggestions(editor.state, ids)
      : dismissSuggestions(editor.state.tr, ids);
    if (tr) editor.view.dispatch(tr);
  };

  return (
    <>
      <button
        type="button"
        title={t("drive.doc.proofread.start")}
        aria-label={t("drive.doc.proofread.start")}
        onMouseDown={keepSelection}
        onClick={start}
        disabled={progress !== null}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-somnus-subtle hover:bg-white/10 hover:text-somnus-text disabled:opacity-60"
      >
        <Icon name="sparkles" className="h-[18px] w-[18px]" />
        {progress
          ? t("drive.doc.proofread.working", {
              done: progress[0] + 1,
              total: Math.max(progress[1], 1),
            })
          : t("drive.doc.proofread.label")}
      </button>
      <label>
        <span className="sr-only">{t("drive.doc.proofread.mode")}</span>
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value === "apply" ? "apply" : "suggest")}
          title={t("drive.doc.proofread.mode")}
          className="rounded-md border border-white/10 bg-somnus-background px-1 py-1 text-sm text-somnus-text"
        >
          <option value="suggest">{t("drive.doc.proofread.suggest")}</option>
          <option value="apply">{t("drive.doc.proofread.apply")}</option>
        </select>
      </label>

      {active && coords
        ? createPortal(
            <div
              role="dialog"
              aria-label={t("drive.doc.proofread.suggestion")}
              className="fixed z-[60] w-72 rounded-xl border border-white/10 bg-[#0f1528] p-3 text-sm shadow-2xl"
              style={{
                left: Math.min(coords.left, window.innerWidth - 300),
                top: coords.bottom + 8,
              }}
            >
              <p className="text-somnus-subtle line-through">{active.original}</p>
              <p className="mt-0.5 font-medium text-emerald-300">{active.replacement || "—"}</p>
              {active.reason ? (
                <p className="mt-1 text-xs text-somnus-subtle">{active.reason}</p>
              ) : null}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => act([active.id], false)}
                  className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-somnus-text hover:bg-white/5"
                >
                  {t("drive.doc.proofread.dismiss")}
                </button>
                <button
                  type="button"
                  onClick={() => act([active.id], true)}
                  className="rounded-md bg-somnus-primary-strong px-2.5 py-1 text-xs font-medium text-white hover:brightness-110"
                >
                  {t("drive.doc.proofread.accept")}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}

      {state.items.length > 0 || message
        ? createPortal(
            <div
              role="status"
              className="fixed right-4 bottom-4 z-[60] flex items-center gap-3 rounded-full border border-white/10 bg-[#0f1528]/95 px-4 py-2 text-sm text-somnus-text shadow-2xl"
            >
              {state.items.length > 0 ? (
                <>
                  <span>{t("drive.doc.proofread.count", { count: state.items.length })}</span>
                  <button
                    type="button"
                    onClick={() =>
                      act(
                        state.items.map((s) => s.id),
                        true,
                      )
                    }
                    className="font-medium text-emerald-300 hover:underline"
                  >
                    {t("drive.doc.proofread.acceptAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      act(
                        state.items.map((s) => s.id),
                        false,
                      )
                    }
                    className="text-somnus-subtle hover:underline"
                  >
                    {t("drive.doc.proofread.dismissAll")}
                  </button>
                </>
              ) : (
                <>
                  <span>{message}</span>
                  <button
                    type="button"
                    onClick={() => setMessage(null)}
                    aria-label={t("ui.close")}
                    className="rounded p-0.5 hover:bg-white/10"
                  >
                    <Icon name="x" className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>,
            document.body,
          )
        : null}

      {asking ? (
        <Modal title={t("drive.doc.proofread.noticeTitle")} onClose={() => setAsking(false)}>
          <div className="flex flex-col gap-3 text-sm text-somnus-subtle">
            <p>{t("drive.doc.proofread.notice")}</p>
            <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-amber-200">
              {t("drive.doc.proofread.warning")}
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAsking(false)}>
                {t("drive.cancel")}
              </Button>
              <Button
                onClick={() => {
                  acceptSpeechNotice("proofread");
                  setAsking(false);
                  void run();
                }}
              >
                {t("drive.doc.proofread.noticeAccept")}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Opens the suggestion the caret was put in, or closes it. */
export function openSuggestion(editor: Editor, id: string | null) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(activateSuggestion(editor.state.tr, id));
}
