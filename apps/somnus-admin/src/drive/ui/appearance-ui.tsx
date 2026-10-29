import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { Icon, type IconName } from "../../components/ui/Icon.js";
import { Modal } from "../../components/ui/ui.js";
import {
  type Appearance,
  colorHex,
  DRIVE_COLORS,
  DRIVE_ICONS,
  type DriveColor,
  type DriveIcon,
} from "../appearance.js";

/**
 * A folder's, note's or file's mark in the Drive: its chosen icon (or its
 * kind's icon) in its chosen colour. Decorative -- the name beside it is what
 * is read out.
 */
export function ItemGlyph({
  icon,
  appearance,
  className,
  fallbackClass,
}: {
  icon: IconName;
  appearance: Appearance | undefined;
  /** Size, e.g. "h-5 w-5". */
  className: string;
  /** Classes for the icon when no colour was chosen. */
  fallbackClass?: string;
}) {
  const hex = colorHex(appearance?.color);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 ${hex ? "" : (fallbackClass ?? "")}`}
      style={hex ? { color: hex } : undefined}
    >
      <Icon name={appearance?.icon ?? icon} className={className} />
    </span>
  );
}

/** A colour swatch behind a card or a shared folder tile, faint enough to keep text readable. */
export function tint(appearance: Appearance | undefined): { backgroundColor: string } | undefined {
  const hex = colorHex(appearance?.color);
  return hex ? { backgroundColor: `${hex}1f` } : undefined;
}

/** Choose a colour and an icon for one item. Nothing chosen means the default look. */
export function AppearanceDialog({
  name,
  icon,
  initial,
  busy,
  onSave,
  onClose,
}: {
  name: string;
  /** The item's kind icon, used when no icon is chosen. */
  icon: IconName;
  initial: Appearance;
  busy: boolean;
  onSave: (appearance: Appearance) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [color, setColor] = useState<DriveColor | undefined>(initial.color);
  const [chosen, setChosen] = useState<DriveIcon | undefined>(initial.icon);
  const next: Appearance = { ...(color ? { color } : {}), ...(chosen ? { icon: chosen } : {}) };
  const hex = colorHex(color);

  return (
    <Modal title={t("drive.appearance.title", { name })} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-somnus-background/60 p-3">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.04]"
            style={tint(next)}
          >
            <ItemGlyph
              icon={icon}
              appearance={next}
              className="h-6 w-6"
              fallbackClass="text-somnus-primary"
            />
          </span>
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
            {t("drive.appearance.icon")}
          </legend>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1">
            <button
              type="button"
              aria-pressed={chosen === undefined}
              aria-label={t("drive.appearance.defaultIcon")}
              title={t("drive.appearance.defaultIcon")}
              onClick={() => setChosen(undefined)}
              className={`flex h-10 items-center justify-center rounded-lg border ${
                chosen === undefined
                  ? "border-somnus-primary bg-somnus-primary/15"
                  : "border-white/10 hover:bg-white/10"
              }`}
              style={hex ? { color: hex } : undefined}
            >
              <Icon name={icon} className="h-5 w-5" />
            </button>
            {DRIVE_ICONS.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={chosen === key}
                aria-label={t(`drive.appearance.icons.${key}`)}
                title={t(`drive.appearance.icons.${key}`)}
                onClick={() => setChosen(key)}
                className={`flex h-10 items-center justify-center rounded-lg border ${
                  chosen === key
                    ? "border-somnus-primary bg-somnus-primary/15"
                    : "border-transparent text-somnus-subtle hover:bg-white/10 hover:text-somnus-text"
                }`}
                style={hex && chosen === key ? { color: hex } : undefined}
              >
                <Icon name={key} className="h-5 w-5" />
              </button>
            ))}
          </div>
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
