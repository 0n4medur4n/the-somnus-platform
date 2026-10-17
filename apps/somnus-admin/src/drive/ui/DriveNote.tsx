import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { Field } from "../../components/Field.js";
import { Notice } from "./drive-ui.js";

/**
 * Writes or edits a note -- usage instructions, the steps of a protocol. The
 * text goes to `onSave` and from there straight into `encryptBlock`; this
 * component keeps it only in React state.
 */
export function DriveNoteEditor({
  initialTitle,
  initialBody,
  busy,
  error,
  onSave,
  onCancel,
}: {
  initialTitle: string;
  initialBody: string;
  busy: boolean;
  error: string | null;
  onSave: (title: string, body: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim().length === 0) return;
    onSave(title.trim(), body);
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border border-somnus-subtle/20 bg-somnus-surface p-4"
    >
      <h3 className="text-lg font-medium text-somnus-text">{t("drive.note.heading")}</h3>
      <Field
        label={t("drive.note.title")}
        value={title}
        maxLength={200}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
      />
      <label htmlFor="drive-note-body" className="text-sm font-medium text-somnus-text">
        {t("drive.note.body")}
      </label>
      <p id="drive-note-hint" className="text-sm text-somnus-subtle">
        {t("drive.note.bodyHint")}
      </p>
      <textarea
        id="drive-note-body"
        aria-describedby="drive-note-hint"
        rows={14}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="rounded-md border border-somnus-muted/40 bg-somnus-background px-3 py-2 font-mono text-sm text-somnus-text"
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || title.trim().length === 0}>
          {busy ? t("drive.working") : t("drive.note.save")}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("drive.cancel")}
        </Button>
      </div>
    </form>
  );
}
