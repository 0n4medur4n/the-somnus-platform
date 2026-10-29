import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { Icon, type IconName } from "../../components/ui/Icon.js";
import { Modal } from "../../components/ui/ui.js";
import {
  type Appearance,
  cleanEmoji,
  colorHex,
  DRIVE_COLORS,
  type DriveColor,
  EMOJI_SUGGESTIONS,
} from "../appearance.js";

/**
 * A folder's, note's or file's mark in the Drive: its emoji when it has one,
 * otherwise its kind's icon in its colour. Decorative -- the name beside it is
 * what is read out.
 */
export function ItemGlyph({
  icon,
  appearance,
  className,
  fallbackClass,
  emojiClass = "text-lg",
}: {
  icon: IconName;
  appearance: Appearance | undefined;
  /** Size, e.g. "h-5 w-5". */
  className: string;
  /** Classes for the icon when no colour was chosen. */
  fallbackClass?: string;
  /** Font size for an emoji, e.g. "text-4xl" on a grid card. */
  emojiClass?: string;
}) {
  if (appearance?.emoji) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex shrink-0 items-center justify-center leading-none ${className} ${emojiClass}`}
      >
        {appearance.emoji}
      </span>
    );
  }
  const hex = colorHex(appearance?.color);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 ${hex ? "" : (fallbackClass ?? "")}`}
      style={hex ? { color: hex } : undefined}
    >
      <Icon name={icon} className={className} />
    </span>
  );
}

/** A colour swatch behind a note card or a shared folder tile, faint enough to keep text readable. */
export function tint(appearance: Appearance | undefined): { backgroundColor: string } | undefined {
  const hex = colorHex(appearance?.color);
  return hex ? { backgroundColor: `${hex}1f` } : undefined;
}

/** Choose a colour and an emoji for one item. Empty means the default look. */
export function AppearanceDialog({
  name,
  icon,
  initial,
  busy,
  onSave,
  onClose,
}: {
  name: string;
  icon: IconName;
  initial: Appearance;
  busy: boolean;
  onSave: (appearance: Appearance) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [color, setColor] = useState<DriveColor | undefined>(initial.color);
  const [emoji, setEmoji] = useState<string | undefined>(initial.emoji);
  const [typed, setTyped] = useState("");
  const typedOk = typed.trim() === "" || cleanEmoji(typed) !== undefined;
  const next: Appearance = { ...(color ? { color } : {}), ...(emoji ? { emoji } : {}) };

  return (
    <Modal title={t("drive.appearance.title", { name })} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-somnus-background/60 p-3">
          <ItemGlyph
            icon={icon}
            appearance={next}
            className="h-7 w-7"
            emojiClass="text-2xl"
            fallbackClass="text-somnus-primary"
          />
          <span className="min-w-0 truncate font-medium text-somnus-text">{name}</span>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-somnus-text">
            {t("drive.appearance.color")}
          </legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={color === undefined}
              onClick={() => setColor(undefined)}
              title={t("drive.appearance.noColor")}
              className={`flex h-8 items-center rounded-full border px-3 text-xs ${
                color === undefined
                  ? "border-somnus-primary text-somnus-text"
                  : "border-white/15 text-somnus-subtle hover:bg-white/5"
              }`}
            >
              {t("drive.appearance.noColor")}
            </button>
            {DRIVE_COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-label={t(`drive.appearance.colors.${c.key}`)}
                title={t(`drive.appearance.colors.${c.key}`)}
                aria-pressed={color === c.key}
                onClick={() => setColor(c.key)}
                className={`h-8 w-8 rounded-full border-2 ${
                  color === c.key ? "border-white" : "border-transparent hover:border-white/40"
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-somnus-text">
            {t("drive.appearance.emoji")}
          </legend>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              aria-pressed={emoji === undefined}
              onClick={() => setEmoji(undefined)}
              className={`flex h-9 items-center rounded-lg border px-3 text-xs ${
                emoji === undefined
                  ? "border-somnus-primary text-somnus-text"
                  : "border-white/15 text-somnus-subtle hover:bg-white/5"
              }`}
            >
              {t("drive.appearance.noEmoji")}
            </button>
            {EMOJI_SUGGESTIONS.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={e}
                aria-pressed={emoji === e}
                onClick={() => setEmoji(e)}
                className={`flex h-9 w-9 items-center justify-center rounded-lg border text-lg ${
                  emoji === e
                    ? "border-somnus-primary bg-somnus-primary/15"
                    : "border-transparent hover:bg-white/10"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
          <label className="mt-3 flex flex-col gap-1 text-sm text-somnus-subtle">
            {t("drive.appearance.typeEmoji")}
            <span className="flex gap-2">
              <input
                value={typed}
                maxLength={16}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="🙂"
                className="w-24 rounded-md border border-white/15 bg-somnus-background px-3 py-1.5 text-lg text-somnus-text"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={!typedOk || typed.trim() === ""}
                onClick={() => {
                  const value = cleanEmoji(typed);
                  if (value) {
                    setEmoji(value);
                    setTyped("");
                  }
                }}
              >
                {t("drive.appearance.useEmoji")}
              </Button>
            </span>
            {!typedOk ? (
              <span role="alert" className="text-xs text-somnus-danger">
                {t("drive.appearance.notAnEmoji")}
              </span>
            ) : null}
          </label>
        </fieldset>

        <p className="text-xs text-somnus-subtle">{t("drive.appearance.encrypted")}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("drive.cancel")}
          </Button>
          <Button type="button" disabled={busy} onClick={() => onSave(next)}>
            {busy ? t("drive.working") : t("drive.appearance.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
